#!/bin/bash
set -e

ETH_NETWORK="${1:-ganache}"
version="${2:-latest}"

dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
project="`cat $dir/../package.json | jq .name | tr -d '"'`"
# cwd="`pwd`"

if [[ "`pwd`" =~ /mnt/c/(.*) ]]
then home_dir=//c/${BASH_REMATCH[1]}
else home_dir="`pwd`"
fi

registry="connextproject"

name=${project}_contract_deployer
log="$home_dir/ops/ethprovider/ganache.log"
image="${project}_ethprovider:$version"

########################################
# Setup env vars

INFURA_KEY=$INFURA_KEY

if [[ "$ETH_NETWORK" == "ganache" ]]
then ETH_PROVIDER="http://localhost:8545"
fi

if [[ -z "$ETH_MNEMONIC" ]]
then ETH_MNEMONIC="candy maple cake sugar pudding cream honey rich smooth crumble sweet treat"
fi

if [[ -z "$ETH_PROVIDER" && -n "$INFURA_KEY" ]]
then echo "Deploying contracts to $ETH_NETWORK via Infura"
elif [[ -n "$ETH_PROVIDER" ]]
then echo "Deploying contracts to $ETH_NETWORK via provider: $ETH_PROVIDER"
else echo "Please set either an ETH_PROVIDER or INFURA_KEY env var to deploy" && exit
fi

sleep 1 # give the user a sec to ctrl-c in case above is wrong

########################################
# Load private key into secret store
# Unless we're using ganache, in which case we'll use the ETH_MNEMONIC

# Docker swarm mode needs to be enabled to use the secret store
docker swarm init 2> /dev/null || true

ETH_MNEMONIC_FILE=${project}_mnemonic_$ETH_NETWORK
if [[ "$ETH_NETWORK" != "ganache" ]]
then
  # Sanity check: does this secret already exist?
  if [[ -n "`docker secret ls | grep " $ETH_MNEMONIC_FILE"`" ]]
  then
    echo "A secret called $ETH_MNEMONIC_FILE already exists"
    echo "Remove existing secret to reset: docker secret rm $ETH_MNEMONIC_FILE"
  else
    echo "Copy your $ETH_MNEMONIC_FILE secret to your clipboard"
    echo "Paste it below & hit enter (no echo)"
    echo -n "> "
    read -s secret
    echo

    id="`echo $secret | tr -d '\n\r' | docker secret create $ETH_MNEMONIC_FILE -`"
    if [[ "$?" == "0" ]]
    then echo "Successfully loaded secret into secret store"
         echo "name=$ETH_MNEMONIC_FILE id=$id"
    else echo "Something went wrong creating secret called $ETH_MNEMONIC_FILE"
    fi
  fi
fi

# TODO - restore this
# touch $log

########################################
# Remove this deployer service when we're done

function cleanup {
  echo
  echo "Contract deployment complete, removing service:"
  docker service remove $name 2> /dev/null || true
  if [[ -n "$logs_pid" ]]
  then kill $logs_pid
  fi
  echo "Done!"
}
trap cleanup EXIT

########################################
# Deploy contracts

if [[ "$ETH_NETWORK" != "ganache" ]]
then SECRET_ENV="--env=ETH_MNEMONIC_FILE=/run/secrets/$ETH_MNEMONIC_FILE --secret=$ETH_MNEMONIC_FILE"
fi

echo
echo "Deploying contract deployer (image: $image)..."

if [[ "`docker image ls -q $image`" == "" ]]
then
  echo "Image $image does not exist locally, trying $registry/$image"
  image=$registry/$image
  if [[ "`docker image ls -q $image`" == "" ]]
  then docker pull $image || (echo "Image does not exist" && exit 1)
  fi
fi

id="`
  docker service create \
    --detach \
    --name="$name" \
    --env="ETH_MNEMONIC=$ETH_MNEMONIC" \
    --env="ETH_NETWORK=$ETH_NETWORK" \
    --env="ETH_PROVIDER=$ETH_PROVIDER" \
    --env="INFURA_KEY=$INFURA_KEY" \
    --mount="type=volume,source=${project}_chain_dev,target=/data" \
    --mount="type=bind,source=$log,target=/root/ganache.log" \
    --mount="type=bind,source=$home_dir/address-book.json,target=/root/address-book.json" \
    --network=host \
    --restart-condition="none" \
    $SECRET_ENV \
    --entrypoint "bash" \
#    // TODO - review this vvvv cf v2.4.0
    ${project}_builder -c '
      if [[ "$ETH_NETWORK" == "ganache" ]]
      then
        echo "Starting Ganache.."
        mkdir -p /data
        ./node_modules/.bin/ganache-cli \
          --db="/data" \
          --gasPrice="10000000000" \
          --host="0.0.0.0" \
          --mnemonic="$ETH_MNEMONIC" \
          --networkId="4447" \
          --port="8545" \
           > ops/ganache.log &
        bash /ops/wait-for.sh localhost:8545 2> /dev/null
      fi
      touch address-book.json
      node ops/migrate-contracts.js
    ' 2> /dev/null
`"

echo "Success! Deployer service started with id: $id"
echo

docker service logs --raw --follow $name &
logs_pid=$!

# Wait for the deployer to exit..
while [[ -z "`docker container ls -a | grep "$name" | grep "Exited"`" ]]
do sleep 1
done
