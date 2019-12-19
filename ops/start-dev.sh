#!/usr/bin/env bash
set -e
project="indra"

# Turn on swarm mode if it's not already on
docker swarm init 2> /dev/null || true

####################
# External Env Vars

ETH_NETWORK="${1:-kovan}"
INDRA_ADMIN_TOKEN="${INDRA_ADMIN_TOKEN:-foo}"

####################
# Internal Config
# config & hard-coded stuff you might want to change

log_level=3
nats_port=4222
node_port=8080
dash_port=9999
port=3000

if [[ "$ETH_NETWORK" == "rinkeby" ]]
then eth_rpc_url="https://rinkeby.infura.io/metamask"
elif [[ "$ETH_NETWORK" == "kovan" ]]
then eth_rpc_url="https://kovan.infura.io/metamask"
elif [[ "$ETH_NETWORK" == "ropsten" ]]
then eth_rpc_url="https://rpc.gazecoin.xyz"
elif [[ "$ETH_NETWORK" == "ganache" ]]
then
  eth_rpc_url="http://ethprovider:8545"
  make deployed-contracts
fi

eth_contract_addresses="`cat address-book.json | tr -d ' \n\r'`"
eth_mnemonic="candy maple cake sugar pudding cream honey rich smooth crumble sweet treat"

# database connection settings
pg_db="$project"
pg_password_file="/run/secrets/${project}_database_dev"
pg_host="database"
pg_port="5432"
pg_user="$project"

# docker images
builder_image="${project}_builder"
daicard_devserver_image="$builder_image"
dashboard_image="$builder_image"
database_image="postgres:9-alpine"
ethprovider_image="trufflesuite/ganache-cli:v6.4.5"
nats_image="nats:2.0.0-linux"
node_image="$builder_image"
proxy_image="${project}_proxy:dev"
redis_image=redis:5-alpine
redis_url="redis://redis:6379"
relay_image="${project}_relay"

if [[ "`pwd`" =~ /mnt/c/(.*) ]]
then home_dir=//c/${BASH_REMATCH[1]}
else home_dir="`pwd`"
fi

####################
# Deploy according to above configuration

# Get images that we aren't building locally
function pull_if_unavailable {
  if [[ -z "`docker image ls | grep ${1%:*} | grep ${1#*:}`" ]]
  then docker pull $1
  fi
}
pull_if_unavailable "$database_image"
pull_if_unavailable "$ethprovider_image"
pull_if_unavailable "$nats_image"

# Initialize random new secrets
function new_secret {
  secret=$2
  if [[ -z "$secret" ]]
  then secret=`head -c 32 /dev/urandom | xxd -plain -c 32 | tr -d '\n\r'`
  fi
  if [[ -z "`docker secret ls -f name=$1 | grep -w $1`" ]]
  then
    id=`echo $secret | tr -d '\n\r' | docker secret create $1 -`
    echo "Created secret called $1 with id $id"
  fi
}
new_secret "${project}_database_dev" "$project"

eth_mnemonic_name="${project}_mnemonic_$ETH_NETWORK"

# Deploy with an attachable network so tests & the daicard can connect to individual components
if [[ -z "`docker network ls -f name=$project | grep -w $project`" ]]
then
  id="`docker network create --attachable --driver overlay $project`"
  echo "Created ATTACHABLE network with id $id"
fi

number_of_services=8 # NOTE: Gotta update this manually when adding/removing services :(

mkdir -p /tmp/$project
cat - > /tmp/$project/docker-compose.yml <<EOF
version: '3.4'

networks:
  $project:
    external: true
  bridge:
    external: true

secrets:
  ${project}_database_dev:
    external: true
  # vvvv remove for ganache vvvvv
  $eth_mnemonic_name:
    external: true

volumes:
  certs:
  chain_dev:
  database_dev:

services:
  proxy:
    image: $proxy_image
    environment:
      DAICARD_URL: http://daicard:3000
      ETH_RPC_URL: $eth_rpc_url
      MESSAGING_URL: http://relay:4223
      MODE: dev
    networks:
      - $project
      - bridge
    ports:
      - "$port:80"
    volumes:
      - certs:/etc/letsencrypt

  daicard:
    image: $daicard_devserver_image
    entrypoint: npm start
    environment:
      NODE_ENV: development
    networks:
      - $project
    volumes:
      - $home_dir:/root
    working_dir: /root/modules/daicard

  dashboard:
    image: $dashboard_image
    entrypoint: npm start
    environment:
      NODE_ENV: development
    networks:
      - $project
    ports:
      - "$dash_port:3000"
    volumes:
      - $home_dir:/root
    working_dir: /root/modules/dashboard

  node:
    image: $node_image
    entrypoint: bash modules/node/ops/entry.sh
    environment:
      INDRA_ADMIN_TOKEN: $INDRA_ADMIN_TOKEN
      INDRA_ETH_CONTRACT_ADDRESSES: '$eth_contract_addresses'
#     INDRA_ETH_MNEMONIC: $eth_mnemonic
      INDRA_ETH_MNEMONIC_FILE: /run/secrets/$eth_mnemonic_name
      INDRA_ETH_RPC_URL: $eth_rpc_url
      INDRA_LOG_LEVEL: $log_level
      INDRA_NATS_CLUSTER_ID:
      INDRA_NATS_SERVERS: nats://nats:$nats_port
      INDRA_NATS_TOKEN:
      INDRA_PG_DATABASE: $pg_db
      INDRA_PG_HOST: $pg_host
      INDRA_PG_PASSWORD_FILE: $pg_password_file
      INDRA_PG_PORT: $pg_port
      INDRA_PG_USERNAME: $pg_user
      INDRA_PORT: $node_port
      INDRA_REDIS_URL: $redis_url
      NODE_ENV: development
    networks:
      - $project
      - bridge
    ports:
      - "$node_port:$node_port"
    secrets:
      - ${project}_database_dev
      - $eth_mnemonic_name
    volumes:
      - $home_dir:/root

#  ethprovider:
#    image: $ethprovider_image
#    command: ["--db=/data", "--mnemonic=$eth_mnemonic", "--networkId=4447"]
#    networks:
#      - $project
#    ports:
#      - "8545:8545"
#    volumes:
#      - chain_dev:/data

  database:
    image: $database_image
    deploy:
      mode: global
    environment:
      POSTGRES_DB: $project
      POSTGRES_PASSWORD_FILE: $pg_password_file
      POSTGRES_USER: $project
    networks:
      - $project
    ports:
      - "$pg_port:$pg_port"
    secrets:
      - ${project}_database_dev
    volumes:
      - database_dev:/var/lib/postgresql/data

  nats:
    command: -V
    image: $nats_image
    networks:
      - $project
    ports:
      - "$nats_port:$nats_port"

  relay:
    image: $relay_image
    command: ["nats:$nats_port"]
    networks:
      - $project
    ports:
      - "4223:4223"

  redis:
    image: $redis_image
    networks:
      - $project
    ports:
      - "6379:6379"

EOF

docker stack deploy -c /tmp/$project/docker-compose.yml $project
rm -rf /tmp/$project

echo -n "Waiting for the $project stack to wake up."
while [[ "`docker container ls | grep $project | wc -l | tr -d ' '`" != "$number_of_services" ]]
do echo -n "." && sleep 2
done
echo " Good Morning!"
