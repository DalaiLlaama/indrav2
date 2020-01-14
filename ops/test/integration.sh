#!/usr/bin/env bash
set -e

dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
project="`cat $dir/../../package.json | jq .name | tr -d '"'`"
name="${project}_test_runner"
commit="`git rev-parse HEAD | head -c 8`"
release="`cat package.json | grep '"version":' | awk -F '"' '{print $4}'`"

if [[ "$TEST_MODE" == "release" ]]
then image=$name:$release;
elif [[ "$TEST_MODE" == "staging" ]]
then image=$name:$commit;
elif [[ -n "`docker image ls -q $name:$1`" ]]
then image=$name:$1; shift # rm $1 from $@
elif [[ -z "$1" || -z "`docker image ls -q $name:$1`" ]]
then
  if [[ -n "`docker image ls -q $name:$commit`" ]]
  then image=$name:$commit
  else image=$name:latest
  fi
else echo "Aborting: couldn't find an image to run for input: $1" && exit 1
fi

# If file descriptors 0-2 exist, then we're prob running via interactive shell instead of on CD/CI
test -t 0 -a -t 1 -a -t 2 && interactive="--interactive"

if [[ $@ == *"--watch"* ]]
then watchOptions="\
  --mount=type=bind,source=$dir/../,target=/root \
  --workdir=/root/modules/test-runner \
  --env=MODE=watch \
  "
fi

echo "Executing image $image"

exec docker run \
  $watchOptions \
  --env="ECCRYPTO_NO_FALLBACK=true" \
  --env="INDRA_CLIENT_LOG_LEVEL=$LOG_LEVEL" \
  --env="INDRA_ETH_RPC_URL=$ETH_RPC_URL" \
  --env="INDRA_NODE_URL=$NODE_URL" \
  $interactive \
  --name="$name" \
  --rm \
  --tty \
  $image $@
