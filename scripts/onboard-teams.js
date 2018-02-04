const fs = require('fs')
const os = require('os')
const path = require('path')

const _ = require('lodash')
const inquirer = require('inquirer')

const SparkTools = require('../source/SparkTools.js')
const inquirerSeparator = (line = '-') => new inquirer.Separator(line)

const CHOICES_PAGE_SIZE = process.stdout.rows || 10
const DEFAULT_NEW_TEAM_NAME = 'My newest Spark Team'
const NEW_TEAM_CHOICE = 'Create a new Spark Team'

// these bits probably need more work:
const notEmailPattern = () => /[,\s]+/g
const logError = (anyString, anyError) => {
	// eslint-disable-next-line no-console
	console.error(anyString, os.EOL, anyError.message)
}

const promptName = async (spark = new SparkTools(), team = {}) => {
	const teams = await spark.getTeamsUnderMyModeration(spark).catch(() => []) // keys are choices:
	const teamsByChoice = _.keyBy(teams, ({ created, name }) => `${name} (created: ${created})`)
	if (teams.length > 0) {
		const teamChoices = [inquirerSeparator(), NEW_TEAM_CHOICE, inquirerSeparator()].concat(Object.keys(teamsByChoice))
		const askWhichTeam = Object.freeze({
			choices: Object.freeze(teamChoices),
			default: NEW_TEAM_CHOICE,
			message: 'Onboard into which Spark Team?',
			name: 'askWhichTeam',
			pageSize: CHOICES_PAGE_SIZE,
			type: 'list',
		})
		const askTeamName = Object.freeze({
			default: team.name || DEFAULT_NEW_TEAM_NAME,
			message: 'Name for new Spark Team?',
			name: 'askTeamName',
			when: answers => answers[askWhichTeam.name] === NEW_TEAM_CHOICE,
		})
		const questions = [askWhichTeam, askTeamName]
		const answers = await inquirer.prompt(questions)
		// https://www.npmjs.com/package/inquirer#examples
		const existingTeam = teamsByChoice[answers[askWhichTeam.name]]
		if (existingTeam) Object.assign(team, existingTeam)
		else team.name = answers[askTeamName.name]
	}
	return team
}

const onboardTeams = async (userAccessToken, teamRosterFiles, isDryRun) => {
	const script = SparkTools.fromAccessToken(userAccessToken)
	const onboardTeam = async ({ id, name }, ...personEmails) => {
		const createTeam = !!name && !id // only create a team if the name is provided, and no ID
		const team = await (createTeam ? script.createTeamWithMyself({ name }) : script.getTeam(id))
		const addPersonToTeamErrors = new Map()
		for (const personEmail of personEmails) {
			try {
				await script.addPersonToTeam(personEmail, team.id)
			} catch (sparkError) {
				addPersonToTeamErrors.set(personEmail, sparkError)
			}
		}
		// these errors are probably not recoverable:
		for (const [personEmail, sparkError] of addPersonToTeamErrors) {
			logError(`failed to add person (email: ${personEmail}) to team (name: ${team.name}) due to:`, sparkError)
		}
		return team
	}
	const teamRosters = new Map() // from team:Object => personEmails:Set<String>
	for (const [teamname, filename] of Object.entries(teamRosterFiles)) {
		const setupErrors = []
		try {
			const personEmails = fs.readFileSync(filename).toString().split(notEmailPattern())
			teamRosters.set({ name: teamname }, new Set(personEmails.filter(notFalsey => !!notFalsey)))
		} catch (setupError) {
			setupErrors.push(setupError)
		}
		if (setupErrors.length > 0) {
			const messages = Array.from(setupErrors, setupError => setupError.message)
			throw new Error(`${messages.length} setup error(s):${os.EOL}${messages.join(os.EOL)}`)
		}
	}
	if (!isDryRun) {
		const onboardTeamErrors = new Map()
		for (const [rosteredTeam, personEmails] of teamRosters) {
			try {
				await promptName(script, rosteredTeam) // interactive
				await onboardTeam(rosteredTeam, ...personEmails)
			} catch (sparkError) {
				onboardTeamErrors.set(rosteredTeam, sparkError)
			}
		}
		for (const [targetTeam, sparkError] of onboardTeamErrors) {
			logError(`failed to onboard team (name: ${targetTeam.name}) due to:`, sparkError)
		}
	}
	return teamRosters
}

if (!module.parent) {
	/* eslint-disable no-console */
	const rosters = process.argv.slice(2)
	if (rosters.length === 0) {
		console.error(`USAGE: node ${__filename} roster1.txt roster2.txt ...`)
		console.error('# filename (w/o .txt) is new team name; for existing team, use $id.txt; rosters list email addresses')
		process.exit() // eslint-disable-line no-process-exit
	}
	const { CISCOSPARK_ACCESS_TOKEN, DRY_RUN } = Object(process.env)
	const isDryRun = Boolean(JSON.parse(DRY_RUN || 'null')) // default: false
	const keys = Array.from(rosters, roster => roster.replace(/\.txt$/, ''))
	const values = Array.from(rosters, roster => path.resolve(process.cwd(), roster))
	onboardTeams(CISCOSPARK_ACCESS_TOKEN, _.zipObject(keys, values), isDryRun)
		.then((result) => {
			for (const [teamName, personEmails] of result) {
				if (DRY_RUN) {
					console.log(`team (name: ${teamName}) onboarding (rostered: ${personEmails.size}) dry run:`)
				} else {
					console.log(`team (name: ${teamName}) onboarding (rostered: ${personEmails.size}) complete:`)
				}
				for (const personEmail of personEmails) {
					console.log(`\t${personEmail}`)
				}
			}
		})
		.catch((reason) => {
			console.error(reason)
			process.exitCode = 1
		})
}
