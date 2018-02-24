#!/usr/bin/env bash

function b64d {
	for BASE64 in "$@"
	do echo "$(echo $BASE64 | base64 -d 2> /dev/null)"
	done
}

function json {
	time curl -s \
		-H 'Accept: application/json' \
		-H 'Content-Type: application/json' \
		"$@" | jq '.'
}

export CISCOSPARK_DEVELOPER_TOKEN="PASTE_ME_FROM_THE_PORTAL"
export CISCOSPARK_ORIGIN_URL='https://api.ciscospark.com'

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
