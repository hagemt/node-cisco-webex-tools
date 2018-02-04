# ciscospark-tools

Refer to the main README.md for now.

Supplimental documentation goes in this folder.

The `man` subdirectory contains compiled manual pages.

## Scripts API

Please fork and open Pull Requests that add value to `ciscospark-tools`! (max one script per PR, please)

Each script should ideally consist of a single module and follow the general conventions of `onboard-teams`.

(i.e. make use of `support` to interface with ciscospark.com, with operator interaction when necessary)

Scripts added this way will be callable via the `ciscospark-tools` command, or `npm run script`.

Read `scripts/index.js` and "Support API" (below) for some helpful hints. Happy hacking!

## Support API

The default export is `class SparkTools`, which has a `constructor` that should not be called directly.

Instances of `SparkTools` should be created via the static factory methods, such as `fromAccessToken`.

`SparkTools` class methods are either "plumbing" or "porcelian" (makes use of the plumbing) in nature.

This is a common pattern in the *nix tradition for writing "onion" APIs, which is built in layers.

### Plumbing

A plumbing method named `#fetch` wraps all HTTP requests, but most porcelian methods call `.json`.

The `#fetch` method should conform to the WHATWG `fetch` standard: https://fetch.spec.whatwg.org/

The `.json` method is unique to each instance, and it does a lot of work for you, including:

1. Injects the proper Authorization header for each request to `api.ciscospark.com`, etc.
2. Builds request URLs with the CISCOSPARK_URL_ORIGIN (default: `https://api.ciscospark.com`)
3. Will ensure proper request/response body are sent/parsed in JSON. (using standard headers)
4. On status 429 (Too Many Requests) will retry indefinitely, if response provided `Retry-After`.
5. Will reject with a `SparkError` (has friendly `message`) in the case of a non-recoverable error.
6. With `DEBUG=ciscospark-tools`, extra information will be printed to the standard error stream.
7. In the case of a resource with many pages, will parse `Link` headers to aggregate all items.

N.B. The user environment's CISCOSPARK_ACCESS_TOKEN (from dev.ciscospark.com) provides the token for Authorization.

The `debug` module (https://www.npmjs.com/package/debug) is used to print extra information for debugging purposes.

Most code churn will be on the porcelian methods; the essential plumbing should not require too many changes.

### Porcelian

Here's where we should probably try to avoid a junkdrawer of sorts. Consider these existing async methods:

* `addParticipantToTeam` (via email address and team ID; may specify whether or not to add as moderator)
* `createTeamAsModerator` (with a specified titular name; your user will be the team's only moderator)
* `getPersonDetails` and `getTeamDetails` (provided an ID, or Object with .id; default person: "me")
* `findTeams`, `findTeamMembership` and `findTeamsModeratedByMe` (useful for team onboarding, etc.)

Add porcelian methods as needed, if one doesn't already exist. Try to compose where possible.
