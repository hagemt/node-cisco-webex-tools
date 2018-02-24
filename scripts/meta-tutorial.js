/* eslint-env node */
const fs = require('fs')
const os = require('os')
const path = require('path')

const chalk = require('chalk')
const inquirer = require('inquirer')
const _ = require('lodash')

const log = require('../support/log.js')
const packageJSON = require('../package.json')
const SparkTools = require('../support/SparkTools.js')

const RAINBOW = Object.freeze(['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'])
const rainbow = (string, number) => chalk[RAINBOW[number % RAINBOW.length]](string || '')
chalk.rainbow = letters => Array.from(letters, (letter, i) => rainbow(letter, i)).join('')

const GREETING = Object.freeze(['You are the best.', 'You are one of a kind.']) // add to taste
const greeting = (r = Math.random()) => chalk.rainbow(GREETING[Math.floor(r * GREETING.length)])

const BOT_EMAIL_ROSTER = path.resolve(__dirname, '..', 'rosters', 'demo.txt')
const DEFAULT_CONFIG_PATH = path.resolve(os.homedir(), `.${packageJSON.name}`)
const DEVELOPER_PORTAL_URL = 'https://developer.ciscospark.com' // < env? ^
const SECRETS_JSON_PATH = path.resolve(DEFAULT_CONFIG_PATH, 'secrets.json')

const INITIAL_INSTRUCTIONS = `${chalk.rainbow(' * In most environments, this is a one-time setup:')}

\tFrom ${chalk.bold(DEVELOPER_PORTAL_URL)} log in, and click on your avatar in the upper right-hand corner.

\tClick 'Copy' to snag your developer Access Token, but don't Log Out! (will revoke the token) Just close the page!

\t`

const getDisplayName = async () => {
	const spark = SparkTools.fromAccessToken() // from process.env
	const { displayName } = await spark.getPersonDetails('me')
	return displayName
}

const inquireAccessToken = async () => {
	const EXPLAIN_ACCESS_TOKEN = `
\n\tIn order to perform actions on Cisco Spark, ${chalk.bold(`${packageJSON.name} requires an Access Token.`)}
\n\tOne easy way to get an Access Token is from the developer portal: ${chalk.bold(DEVELOPER_PORTAL_URL)}
\n\tLog in, and then click your avatar in the upper right-hand corner. Copy, and then paste into the prompt below.
\n\tSecrets you provide to ${packageJSON.name} are kept safe in this folder: ${chalk.bold(DEFAULT_CONFIG_PATH)}
`
	const askAccessToken = Object.freeze({
		message: 'Access Token:',
		name: 'sparkAccessToken',
		prefix: EXPLAIN_ACCESS_TOKEN,
	})
	const answers = await inquirer.prompt([askAccessToken])
	const sparkAccessToken = answers[askAccessToken.name]
	if (sparkAccessToken) return sparkAccessToken
	throw new Error('no Access Token provided')
}

const loadAuthorization = async () => {
	log.debug('may load Authorization from file: %s', SECRETS_JSON_PATH)
	if (process.env.CISCOSPARK_ACCESS_TOKEN) return // no need to read file
	const { authorization } = JSON.parse(fs.readFileSync(SECRETS_JSON_PATH))
	const anyAccessToken = _.get(authorization, 'access_token') // String
	if (anyAccessToken) process.env.CISCOSPARK_ACCESS_TOKEN = anyAccessToken
}

const saveAuthorization = async (authorization) => {
	const hasDirectory = fs.existsSync(DEFAULT_CONFIG_PATH) && fs.lstatSync(DEFAULT_CONFIG_PATH).isDirectory()
	if (!hasDirectory) fs.mkdirSync(DEFAULT_CONFIG_PATH) // make backup of any existing secrets.json for safety:
	if (fs.existsSync(SECRETS_JSON_PATH)) fs.renameSync(SECRETS_JSON_PATH, `${SECRETS_JSON_PATH}.${Date.now()}`)
	fs.writeFileSync(SECRETS_JSON_PATH, JSON.stringify({ authorization }, null, '\t') + '\n', { mode: 0o600 })
	log.debug('saved Authorization to file: %s', SECRETS_JSON_PATH)
}

module.exports = {
	inquireAccessToken,
	loadAuthorization,
	saveAuthorization,
}

const swallowLogAndReturnNull = (error) => {
	log.debug(error)
	return null
}

if (!module.parent) {
	loadAuthorization()
		.catch(swallowLogAndReturnNull)
		.then(() => getDisplayName())
		.catch(async () => {
			// attempt to recover with interactive prompt:
			const devAccessToken = await inquireAccessToken()
			process.env.CISCOSPARK_ACCESS_TOKEN = devAccessToken
			const displayName = await getDisplayName() // via env
			await saveAuthorization({ access_token: devAccessToken })
			return displayName // failure mode: tell user about env
		})
		.catch(swallowLogAndReturnNull)
		.then((displayName) => {

			const demoCommand = chalk.bold(`${packageJSON.name} onboard-teams ${chalk.red(BOT_EMAIL_ROSTER)}`)
			const envCommand = chalk.bold(`CISCOSPARK_ACCESS_TOKEN=${chalk.red('PASTE_ACCESS_TOKEN_HERE')}`)

			const initialUNIX = `In your .bashrc (or similar) add a line similar to this: export ${envCommand}`
			const initialWindows = `In the environment where you run ${packageJSON.name}: set ${envCommand}`

			const greetingText = `Thanks for using ${packageJSON.name}, ${displayName || 'intrepid explorer'}!`
			const helperText = 'Feel free to run the tutorial whenever something is unclear. I am here to help you!'
			const initialText = INITIAL_INSTRUCTIONS + (process.platform === 'win32' ? initialWindows : initialUNIX)
			const normalText = 'Check teams in your Spark client (after running this command) for a quick demonstration:'
			const updateText = `Tip: use ${chalk.bold(`npm up -g ${packageJSON.name}`)} to install the latest version.`

			/* eslint-disable no-console */
			console.log()
			console.log('\t' + chalk.green(greetingText) + ' ' + chalk.bold(greeting()))
			console.log()
			console.log('\t' + chalk.yellow(displayName ? normalText : helperText))
			console.log()
			console.log('\t' + (displayName ? demoCommand : initialText))
			console.log()
			console.log('\t' + chalk.blue(updateText))
			console.log()
			/* eslint-enable no-console */

		})
}
