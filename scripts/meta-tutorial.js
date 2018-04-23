/* eslint-env node */
const fs = require('fs')
const os = require('os')
const path = require('path')

const chalk = require('chalk')
const inquirer = require('inquirer')
const _ = require('lodash')

const PACKAGE_JSON = require('../package.json')
const ClientError = require('../support/ClientError.js')
const ClientTools = require('../support/ClientTools.js')
const log = require('../support/log.js')

const RAINBOW = Object.freeze(['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'])
const rainbow = (string, number) => chalk[RAINBOW[number % RAINBOW.length]](string || '')
chalk.rainbow = letters => Array.from(letters, (letter, index) => rainbow(letter, index)).join('')

const FLATTERY = Object.freeze(['You are one of a kind.', 'Everyone appreciates you.', 'The world is better with you in it.'])
const flattery = (array = FLATTERY, index = Math.floor(Math.random() * array.length)) => chalk.rainbow(array[index])

const DEVELOPER_PORTAL_URL = 'https://developer.webex.com/getting-started.html#authentication'

const BOT_EMAIL_ROSTER = path.resolve(__dirname, '..', 'rosters', 'demo.txt')
const DEFAULT_DIRECTORY_PATH = path.resolve(os.homedir(), `.${PACKAGE_JSON.name}`)
const SECRETS_JSON_PATH = path.resolve(DEFAULT_DIRECTORY_PATH, 'secrets.json')

const getDisplayName = async (tools = ClientTools.fromAccessToken(process.env.CISCOSPARK_ACCESS_TOKEN), person = 'me') => {
	const { displayName } = await tools.getPersonDetails(person)
	return displayName
}

const acquireAccessToken = async (env = process.env, filepath = SECRETS_JSON_PATH) => {
	if (env.CISCOSPARK_ACCESS_TOKEN) log.debug('will disregard Access Token in environment')
	// N.B. this mechanism must be replaced by an OAuth2 Implicit Grant Flow or similar
	// will redirect browser to a microservice that uses an integration to authenticate
	const EXPLAIN_ACCESS_TOKEN = `
\t
\tIn order to perform actions on behalf of users, ${PACKAGE_JSON.name} requires an Access Token recognized by the API.
\t
\tOne easy way to get an Access Token is from the developer portal: ${chalk.bold(DEVELOPER_PORTAL_URL)}
\t
\tN.B. ${PACKAGE_JSON.name} keeps all your secrets safe in a local file: ${chalk.bold(filepath)}
\t
?`
	const askAccessToken = Object.freeze({
		message: 'Access Token:',
		name: 'newAccessToken',
		prefix: EXPLAIN_ACCESS_TOKEN,
	})
	const answers = await inquirer.prompt([askAccessToken])
	const providedAccessToken = answers[askAccessToken.name]
	if (providedAccessToken) return providedAccessToken
	throw new Error('no Access Token provided')
}

const loadAuthorization = async (env = process.env, filepath = SECRETS_JSON_PATH) => {
	try {
		log.debug('may load Authorization from file: %s', filepath)
		if (env.CISCOSPARK_ACCESS_TOKEN) return // no need to read file
		const { authorization } = JSON.parse(fs.readFileSync(filepath))
		const savedAccessToken = _.get(authorization, 'access_token')
		if (savedAccessToken) env.CISCOSPARK_ACCESS_TOKEN = savedAccessToken
	} catch (error) {
		throw new ClientError(error.message)
	}
}

const saveAuthorization = async (authorization, filepath = SECRETS_JSON_PATH) => {
	const directory = path.dirname(filepath)
	if (!(fs.existsSync(directory) && fs.statSync(directory).isDirectory())) {
		fs.mkdirSync(directory)
	}
	if (fs.existsSync(filepath)) {
		fs.renameSync(filepath, `${filepath}.${Date.now()}`)
	}
	const source = JSON.stringify({ authorization }, null, '\t')
	fs.writeFileSync(filepath, `${source}\n`, { mode: 0o600 })
	log.debug('saved Authorization to file: %s', filepath)
}

module.exports = {
	loadAuthorization,
	saveAuthorization,
}

if (!module.parent) {
	/* eslint-disable no-console */
	loadAuthorization()
		.then(() => getDisplayName())
		.catch(async (loadError) => {
			try {
				if (loadError instanceof ClientError && process.stdin.isTTY) {
					const acquiredAccessToken = await acquireAccessToken()
					const tools = ClientTools.fromAccessToken(acquiredAccessToken)
					const displayName = await getDisplayName(tools)
					await saveAuthorization({
						access_token: acquiredAccessToken,
					})
					return displayName
				} else {
					// probably offline
					log.debug(loadError)
				}
			} catch (saveError) {
				log.debug(saveError)
			}
		})
		.then((displayName) => {

			const demoText = 'Open your favorite client (after running this command) for a quick demonstration:'
			const demoCommand = chalk.bold(`${PACKAGE_JSON.name} onboard-teams ${chalk.dim(BOT_EMAIL_ROSTER)}`)

			const envCommand = chalk.bold(`CISCOSPARK_ACCESS_TOKEN=${chalk.dim('PASTE_ACCESS_TOKEN_HERE')}`)
			const installCommand = chalk.bold(`npm install --global --no-save ${PACKAGE_JSON.name}@latest`)

			const automaticText = 'Feel free to run the tutorial whenever something is unclear. We are here to help you!'
			const greetingText = `Thanks for using ${PACKAGE_JSON.name}, ${displayName || 'intrepid explorer'}!`
			const upgradeText = `Tip: to update (which may change the behavior of some scripts):\n\n\t${installCommand}`

			const manual = `Alternatively, source ~/.bashrc (or similar) with: export ${envCommand}`
			const manualIssue = `Alternatively, see if this issue may impact others: ${PACKAGE_JSON.bugs.url}`
			const manualWindows = `Alternatively, in the environment for ${PACKAGE_JSON.name}: set ${envCommand}`
			const manualText = `We couldn't validate your Access Token. Please retry later, or perhaps with a different user.

\tLog in (if necessary) and read: ${chalk.bold(DEVELOPER_PORTAL_URL)}

\t${PACKAGE_JSON.version.startsWith('0') ? process.platform === 'win32' ? manualWindows : manual : manualIssue}`

			console.log()
			console.log(`\t${chalk.green(greetingText)} ${chalk.bold(flattery())}`)
			console.log()
			console.log(`\t${chalk.yellow(displayName ? demoText : automaticText)}`)
			console.log()
			console.log(`\t${chalk.red(displayName ? demoCommand : manualText)}`)
			console.log()
			console.log(`\t${chalk.blue(upgradeText)}`)
			console.log()

		})
}
