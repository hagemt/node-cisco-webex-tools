/* eslint-env node */
const path = require('path')

const chalk = require('chalk')
//const inquirer = require('inquirer')

const SparkTools = require('../support/SparkTools.js')
const packageJSON = require('../package.json')

const RAINBOW = Object.freeze(['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'])
const rainbow = (string, number) => chalk[RAINBOW[number % RAINBOW.length]](string)
chalk.rainbow = all => Array.from(all, (letter, index) => rainbow(letter, index)).join('')

const GREETING = Object.freeze(['You are the best.', 'You are one of a kind.']) // add to taste
const greeting = (r = Math.random()) => chalk.rainbow(GREETING[Math.floor(r * GREETING.length)])

const getDisplayName = async () => {
	const spark = SparkTools.fromAccessToken() // from process.env
	const { displayName } = await spark.getPersonDetails('me')
	return displayName
}

const DEMO_EMAIL_ROSTER = path.resolve(__dirname, '..', 'rosters', 'demo.txt') // lists bot emails
const DEVELOPER_PORTAL_URL = process.env.CISCOSPARK_URL_PORTAL || 'https://developer.ciscospark.com'

const INITIAL_INSTRUCTIONS = `${chalk.rainbow(' * In most environments, this is a one-time setup:')}

From ${chalk.bold(DEVELOPER_PORTAL_URL)} log in, and click on your avatar in the upper right-hand corner.

Click 'Copy' to snag your developer Access Token, but don't Log Out! (will revoke the token) Just close the page!

`

if (!module.parent) {
	/* eslint-disable no-console */
	getDisplayName()
		.catch(() => null)
		.then((displayName) => {

			const demoCommand = chalk.bold(`${packageJSON.name} onboard-teams ${chalk.red(DEMO_EMAIL_ROSTER)}`)
			const envCommand = chalk.bold(`CISCOSPARK_ACCESS_TOKEN=${chalk.red('PASTE_ACCESS_TOKEN_HERE')}`)

			const initialUNIX = `In your .bashrc (or similar) add a line similar to this: export ${envCommand}`
			const initialWindows = `In the environment where you run ${packageJSON.name}: set ${envCommand}`

			const greetingText = `Thanks for using ${packageJSON.name}, ${displayName || 'intrepid explorer'}!`
			const helperText = 'Feel free to run the tutorial whenever something is unclear. I am here to help you!'
			const initialText = INITIAL_INSTRUCTIONS + (process.platform === 'win32' ? initialWindows : initialUNIX)
			const normalText = 'Check your Spark client (after running this command) for a quick demonstration:'
			const updateText = `Tip: use ${chalk.bold(`npm update -g ${packageJSON.name}`)} to install the latest version.`

			console.log()
			console.log(chalk.green(greetingText) + ' ' + chalk.bold(greeting()))
			console.log()
			console.log(chalk.yellow(displayName ? normalText : helperText))
			console.log()
			console.log(displayName ? demoCommand : initialText)
			console.log()
			console.log(chalk.blue(updateText))
			console.log()

		})
}
