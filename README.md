# cisco-webex-tools

[![npm](https://img.shields.io/npm/v/cisco-webex-tools/latest.svg)](https://www.npmjs.com/package/cisco-webex-tools)
[![node](https://img.shields.io/node/v/cisco-webex-tools.svg)](https://www.npmjs.com/package/cisco-webex-tools)
[![build](https://img.shields.io/travis/hagemt/node-cisco-webex-tools/master.svg)](https://travis-ci.org/hagemt/node-cisco-webex-tools/branches)
[![robot](https://badges.greenkeeper.io/hagemt/node-cisco-webex-tools.svg)](https://greenkeeper.io/)

You: resourceful business communications and collaboration enabler.

You need automation to help your people get stuff done. For example:

* Onboard teams from a roster of email addresses (script name: onboard-teams)
* List/toggle (to get/set) specific feature flags (script name: developer-features)
* Use a guest (JWT login) to send a message to yourself (script name: guest-credentials)
* Make a copy of a space's memberships/messages (script names: export-data/roster-memberships)
* List/create/delete webhooks and diagnose webhook delivery problems (script name: developer-webhooks)

And so much more! Follow the easy setup below to get started! Consider sharing scripts or script ideas!

## Get Started (use scripts)

If your `npm --version` is 5.2.0 or better, try: `npx cisco-webex-tools tutorial`, or else:

1. Install [NodeJS](https://nodejs.org) LTS, if you haven't already. (provides `npm` command)
2. Run `npm install --global cisco-webex-tools` to install the `cisco-webex-tools` command.
3. Read the help text (printed when the command is run without arguments or with -h, --help)

Once installed, `cwt` provides a short alias. Scripts may also have short aliases.

## Get Started (add scripts)

1. Clone this repository into a directory, and therein run `npm install`.
2. Read `Documentation` and some of the `support` and `scripts` code.

Open PRs with anything and everything awesome!

## Troubleshooting

### Help! Install didn't work! (permissions)

The `npx` command (bundled with `node` like `npm`) is easiest, if you just want to run a script once.

Consider a global install via `npm` (adds `cisco-webex-tools` to your `PATH`) if you run scripts often.

In order to install this way, `node` must make network connections and read/write files in certain folders.

If you're on macOS and not using something like `brew`, you may need to use `sudo` .

Another great tool, especially if you have need to manage multiple versions of `node`, is `nvm`.

### Help! Script done't work!

Any script that terminates abnormally may provide you with details useful in filing/fixing a bug.

Consider if that's the right course of action; under normal conditions, no script should crash!

Re-running a command with `-d` or `--debug` might help explain exactly what has gone wrong.

If you think there is a problem with any script, please open an issue or PR on GitHub!
