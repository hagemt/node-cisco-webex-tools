#!/usr/bin/env bash

[[ -x "$(command -v curl)" ]] && [[ -x "$(command -v jq)" ]] && [[ -x "$(command -v node)" ]] || \
	echo 1>&2 "WARNING: required commands are not available (on macOS: brew install curl jq node)"

function b64d {
	if [[ -z "$@" ]]
	then
		while read $TOKEN
		do node -p "Buffer.from('$TOKEN', 'base64').toString()"
		done < /dev/stdin
	else
		for TOKEN in "$@"
		do node -p "Buffer.from('$TOKEN', 'base64').toString()"
		done
	fi
}

function json {
	time curl -s \
		-H 'Accept: application/json' \
		-H 'Content-Type: application/json' \
		"$@" | jq '.'
}

export CISCOSPARK_DEVELOPER_TOKEN="PASTE_ME_FROM_THE_PORTAL" # or after: npm install --global ciscospark-tools
#export CISCOSPARK_DEVELOPER_TOKEN="$(cat ~/.ciscospark-tools/secrets.json | jq '.authorization.access_token' -r)"
export CISCOSPARK_ORIGIN_URL='https://api.ciscospark.com' # try cst: https://www.npmjs.com/package/ciscospark-tools

function spark {
	local readonly TOKEN="$CISCOSPARK_ACCESS_TOKEN"
	local readonly URL="$CISCOSPARK_ORIGIN_URL/v1/$1"
	shift
	json "$URL" -H "Authorization: Bearer $TOKEN" "$@"
}

function tokens {
	export CISCOSPARK_ACCESS_TOKEN="${1:-$CISCOSPARK_DEVELOPER_TOKEN}"
	shift
	echo "spark $CISCOSPARK_ACCESS_TOKEN"
	#spark people/me #-v
}
