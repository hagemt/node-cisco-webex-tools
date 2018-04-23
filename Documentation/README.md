# cisco-webex-tools

Refer to the main README.md for install, etc. Script developer documentation goes in this folder.

Bonus: check out `cisco.army.chainsaw.bash`, and consider adding it to your `~/.bashrc`, or similar.

The assumed shell is `bash` (but is easily portable) with required commands: `base64`, `curl` and `jq`.

## Scripts API

Fork, and then open Pull Requests that add value to `cisco-webex-tools`! (ideally one script per PR, please)

Each script should ideally consist of a single module and follow the general conventions of `onboard-teams`.

Making `scripts` with great UX should be straightforward and may `require` any dependency we bundle.

(i.e. make use of `support` to interface with public APIs, with operator interaction when necessary)

Scripts added this way will be callable via the `cisco-webex-tools` command, or `npm run script`.

Read `scripts/index.js` and "Support API" (below) for some helpful hints. Happy hacking!

## Support API

The default export is `class ClientTools`, which has a `constructor` that SHOULD NOT be called directly.

Instances of `ClientTools` MUST be created via the static factory methods, such as `fromAccessToken`.

`ClientTools` class methods are either "plumbing" or "porcelian" (makes use of the plumbing) in nature.

This is a common pattern in the *nix tradition for writing "onion" APIs, which are built in layers.

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

* `addMembershipToTeam` (via team [.id] and email address [.personEmail]; may also specify [.isModerator])
* `createTeamAsModerator` (with a specified titular name; your user will be the team's only moderator)
* `getPersonDetails` and `getTeamDetails` (provided an ID, or Object with .id; default person: "me")
* `getTeamMembership`, `listDeveloperFeatures` and `setDeveloperFeature` do what they say on the tin
* `listTeams`, `listTeamMemberships` and `listTeamsModeratedByMe` (useful for team onboarding, etc.)

Add porcelian methods as needed, if one doesn't already exist. Try to compose where possible.

#### Complex methods

Some porcelian methods will be more complicated than others; query parameters generally add complexity.

List methods should follow this rule of thumb: use ...args to capture (and filter) supported query options.

For example, to list messages requires a space (first parameter) but should support using max/page options.

N.B. The `validation` support module provides a `.buildURI(uri, query)` method and assorted JOI schema.

### Debug, Logging, Prompts, etc.

Using `console` in scripts should work as expected, but consider interaction with users very carefully.

The `log` support module provides a `.debug(format, ...args)` method that conforms to the `debug` pattern.

Most `scripts` benefit from at least one option, which sets `DEBUG` on the environment as appropriate.

Please note that `package.json` provides some packages for your convenience; these include:

* `chalk`: to color output, before you send it to `console.log`, or similar
* `commander`: to provide more complex scripts with machinery to parse arguments
* `inquirer`: for interactive scripts; see https://www.npmjs.com/package/inquirer
* and more, e.g. `joi` (validation) `lodash` (toolbelt) `node-fetch` (requests)
