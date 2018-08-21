#!/usr/bin/env bash

[[ -x "$(command -v curl)" ]] && [[ -x "$(command -v jo)" ]] && [[ -x "$(command -v jq)" ]] && [[ -x "$(command -v node)" ]] || \
	echo 1>&2 "WARNING: required commands are not available (on macOS: brew update && brew upgrade && brew install curl jo jq node)"

# to decode IDs:
function b64d {
	if [[ -z "$@" ]]
	then
		while read BASE64
		do node -p "Buffer.from('$BASE64', 'base64').toString()"
		done < /dev/stdin
	else
		for BASE64 in "$@"
		do node -p "Buffer.from('$BASE64', 'base64').toString()"
		done
	fi
}

# tweak to taste:
function json {
	time curl -s \
		-H 'Accept: application/json' \
		-H 'Content-Type: application/json' \
		"$@" | jq '.'
}

# if you use these aliases, you might also like to know about the scripting engine provided by cisco-webex-tools (requires NodeJS v8.2+)
# to get started with `cwt` run: `npm install --global cisco-webex-tools` or README: https://www.npmjs.com/package/cisco-webex-tools

#export WEBEX_DEVELOPER_TOKEN="$(cat ~/.cisco-webex-tools/secrets.json | jq '.authorization.access_token' -r)" # alternatively:
export WEBEX_DEVELOPER_TOKEN="PASTE_ME_FROM_THE_PORTAL" # https://developer.webex.com/getting-started.html#authentication

# to target another origin, export a different URL:
#export WEBEX_TEAMS_ORIGIN='https://api.ciscospark.com'

# run this first:
function token {
	export WEBEX_ACCESS_TOKEN="${1:-$WEBEX_DEVELOPER_TOKEN}"
	shift
	echo 'cisco-webex-teams' "Authorization: Bearer $WEBEX_ACCESS_TOKEN"
	webex people/me #-v
}

# now this works:
function webex {
	local readonly HEADER="Authorization: Bearer ${WEBEX_ACCESS_TOKEN}"
	local readonly ORIGIN="${WEBEX_TEAMS_ORIGIN:-https://api.ciscospark.com}"
	local readonly PREFIX="/${WEBEX_API_VERSION:-v1}/" # default resource: ping
	case "$1" in
	create)
		shift
		local readonly URL="${ORIGIN}${PREFIX}${1:-ping}"
		shift
		json "$URL" -H "$HEADER" -d "$(jo $@)" # -X POST is implicit when -d is provided
		;;
	delete)
		shift
		local readonly URL="${ORIGIN}${PREFIX}${1:-ping}"
		shift
		json "$URL" -H "$HEADER" "$@" -X DELETE # consistent w/ default, not create/update
		;;
	update)
		shift
		local readonly URL="${ORIGIN}${PREFIX}${1:-ping}"
		shift
		json "$URL" -H "$HEADER" -d "$(jo $@)" -X PUT # consider doing a GET first?
		;;
	*)
		local readonly URL="${ORIGIN}${PREFIX}${1:-ping}"
		shift
		json "$URL" -H "$HEADER" "$@" # -X GET is implicit, but user can override
	esac
}

# pick your favorite(s):
#alias cisco='webex'
#alias spark='webex'
#alias teams='webex'
