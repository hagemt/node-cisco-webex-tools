const fs = require('fs')
const os = require('os')

//const chalk = require('chalk')
const inquirer = require('inquirer')
const _ = require('lodash')

const ClientTools = require('../support/ClientTools.js')

const inquirerSeparator = () => new inquirer.Separator()
const separateChoices = (...args) => [
	inquirerSeparator(),
	...args,
	inquirerSeparator(),
]

async function addMembershipToSpace (space, membership) {
	if (!membership.isMonitor) {
		try {
			await this.addMembershipToSpace(space, membership)
		} catch (error) {
			// ignore Conflict (person already present)
			if (error.response.status !== 409) {
				// eslint-disable-next-line no-console
				console.error(error.message)
			}
		}
	}
	return space
}

async function addMembershipToTeam (team, membership) {
	try {
		await this.addMembershipToTeam(team, membership)
	} catch (error) {
		// ignore Conflict (person already present)
		if (error.response.status !== 409) {
			// eslint-disable-next-line no-console
			console.error(error.message)
		}
	}
	return team
}

// this is a fast synchronous operation, may be a no-op
const addMembershipToRoster = (roster, membership) => {
	if (!membership.isMonitor && membership.personEmail) {
		roster.push(membership.personEmail)
	}
	return roster
}

const writeLinesToFile = async (roster, ...args) => {
	await new Promise((resolve, reject) => {
		const stream = fs.createWriteStream(...args)
		stream.once('error', (error) => {
			reject(error)
		})
		stream.once('finish', () => {
			resolve()
		})
		stream.write(roster.join(os.EOL) + os.EOL)
	})
}

const cloneSpaceIntoFile = async ({ source, target, tools }) => {
	const memberships = await tools.listSpaceMemberships(source)
	const roster = memberships.reduce(addMembershipToRoster, [])
	await writeLinesToFile(roster, target) // best roster format?
}

const cloneSpaceIntoSpace = async ({ source, target, tools }) => {
	const memberships = await tools.listSpaceMemberships(source)
	await Promise.all(memberships.reduce(addMembershipToSpace, target, tools))
}

const cloneSpaceIntoTeam = async ({ source, target, tools }) => {
	const memberships = await tools.listSpaceMemberships(source)
	await Promise.all(memberships.reduce(addMembershipToTeam, target, tools))
}

const cloneTeamIntoFile = async ({ source, target, tools }) => {
	const memberships = await tools.listTeamMemberships(source)
	const roster = memberships.reduce(addMembershipToRoster, [])
	await writeLinesToFile(roster, target) // best roster format?
}

const cloneTeamIntoSpace = async ({ source, target, tools }) => {
	const memberships = await tools.listTeamMemberships(source)
	await Promise.all(memberships.reduce(addMembershipToSpace, target, tools))
}

const cloneTeamIntoTeam = async ({ source, target, tools }) => {
	const memberships = await tools.listTeamMemberships(source)
	await Promise.all(memberships.reduce(addMembershipToTeam, target, tools))
}

module.exports = {
	cloneSpaceIntoFile,
	cloneSpaceIntoSpace,
	cloneSpaceIntoTeam,
	cloneTeamIntoFile,
	cloneTeamIntoSpace,
	cloneTeamIntoTeam,
}

const buildChoiceObjects = async (tools) => {
	const strcmp = (lhs, rhs) => String.prototype.localeCompare.call(String(lhs), String(rhs))
	const createdMostRecentlyFirst = ({ created: lhs }, { created: rhs }) => new Date(rhs) - new Date(lhs)
	const sortSpaces = spaces => spaces.sort((lhs, rhs) => strcmp(lhs.type, rhs.type) || createdMostRecentlyFirst(lhs, rhs))
	const sortTeams = teams => teams.sort(createdMostRecentlyFirst) // better alternative? alphabetical by name?
	const toSpaceChoiceString = ({ created, title, type }) => `${type}: ${title} (created: ${created})`
	const toTeamChoiceString = ({ created, name }) => `${name} (created: ${created})`
	return {
		spaces: _.keyBy(await tools.listSpaces().then(sortSpaces), toSpaceChoiceString),
		teams: _.keyBy(await tools.listTeams().then(sortTeams), toTeamChoiceString),
	}
}

const inquireSourceTarget = async (tools, guess) => {
	const { spaces, teams } = await buildChoiceObjects(tools)
	const FROM_FILE_CHOICE = 'From local file (roster of email addresses)'
	const NEW_SPACE_CHOICE = 'Create new Space (may add to Team later)'
	const NEW_TEAM_CHOICE = 'Create new Team (has subspaces and General space)'
	const TO_FILE_CHOICE = 'To local file (roster of email addresses)'
	const DEFAULT_SPACE_TITLE = 'Name This Space (created via script)'
	const DEFAULT_TEAM_NAME = 'Name This Team (created via script)'
	const COPY_SPACE_TO_SPACE = 'copy memberships from space to space'
	const COPY_SPACE_TO_TEAM = 'copy memberships from space to team'
	const COPY_TEAM_TO_SPACE = 'copy memberships from team to space'
	const COPY_TEAM_TO_TEAM = 'copy memberships from team to team'
	const CREATE_SPACE_ROSTER = 'create email roster from space memberships'
	const CREATE_TEAM_ROSTER = 'create email roster from team memberships'
	const types = {
		[CREATE_SPACE_ROSTER]: cloneSpaceIntoFile.name,
		[CREATE_TEAM_ROSTER]: cloneTeamIntoFile.name,
		[COPY_SPACE_TO_SPACE]: cloneSpaceIntoSpace.name,
		[COPY_SPACE_TO_TEAM]: cloneSpaceIntoTeam.name,
		[COPY_TEAM_TO_SPACE]: cloneTeamIntoSpace.name,
		[COPY_TEAM_TO_TEAM]: cloneTeamIntoTeam.name,
	}
	const spaceSourceSet = new Set([COPY_SPACE_TO_SPACE, COPY_SPACE_TO_TEAM])
	const teamSourceSet = new Set([COPY_TEAM_TO_SPACE, COPY_TEAM_TO_TEAM])
	const spaceTargetSet = new Set([COPY_SPACE_TO_SPACE, COPY_TEAM_TO_SPACE])
	const teamTargetSet = new Set([COPY_SPACE_TO_TEAM, COPY_TEAM_TO_TEAM])
	// TODO (tohagema): already have onboard-teams; support space/subspace?
	const askWhichType = Object.freeze({
		choices: [
			COPY_SPACE_TO_SPACE,
			COPY_SPACE_TO_TEAM,
			COPY_TEAM_TO_SPACE,
			COPY_TEAM_TO_TEAM,
			CREATE_SPACE_ROSTER,
			CREATE_TEAM_ROSTER,
		],
		default: guess,
		message: 'Verify type of action:',
		name: 'askWhichType',
		type: 'list',
	})
	const askWhichSource = Object.freeze({
		default: FROM_FILE_CHOICE,
		choices: async (answers) => {
			const choices = separateChoices(FROM_FILE_CHOICE)
			if (spaceSourceSet.has(answers[askWhichType.name])) {
				return choices.concat(Object.keys(spaces))
			}
			if (teamSourceSet.has(answers[askWhichType.name])) {
				return choices.concat(Object.keys(teams))
			}
			return choices
		},
		message: 'From which?',
		name: 'askWhichSource',
		type: 'list',
	})
	const askWhichTarget = Object.freeze({
		default: async (answers) => {
			if (spaceTargetSet.has(answers[askWhichType.name])) {
				return NEW_SPACE_CHOICE
			}
			if (teamTargetSet.has(answers[askWhichType.name])) {
				return NEW_TEAM_CHOICE
			}
			return TO_FILE_CHOICE
		},
		choices: async (answers) => {
			const choices = separateChoices(NEW_TEAM_CHOICE)
			if (spaceTargetSet.has(answers[askWhichType.name])) {
				return choices.concat(Object.keys(spaces))
			}
			if (teamTargetSet.has(answers[askWhichType.name])) {
				return choices.concat(Object.keys(teams))
			}
		},
		message: 'To which?',
		name: 'askWhichTarget',
		type: 'list',
	})
	const askSpaceTitle = Object.freeze({
		default: DEFAULT_SPACE_TITLE,
		message: 'Space title?',
		name: 'askSpaceTitle',
		when: async (answers) => {
			const isSpaceSource = answers[askWhichSource.name] === NEW_SPACE_CHOICE
			const isSpaceTarget = answers[askWhichTarget.name] === NEW_SPACE_CHOICE
			return isSpaceSource || isSpaceTarget // N.B. only one can be true
		},
	})
	const askTeamName = Object.freeze({
		default: DEFAULT_TEAM_NAME,
		message: 'Team name?',
		name: 'askTeamName',
		when: async (answers) => {
			const isTeamSource = answers[askWhichSource.name] === NEW_TEAM_CHOICE
			const isTeamTarget = answers[askWhichTarget.name] === NEW_TEAM_CHOICE
			return isTeamSource || isTeamTarget // N.B. only one can be true
		},
	})
	const questions = [askWhichType, askWhichSource, askWhichTarget, askSpaceTitle, askTeamName]
	const answers = await inquirer.prompt(questions) // will throw (reject) on end-of-input
	const result = {
		type: types[answers[askWhichType.name]],
	}
	if (answers[askWhichSource.name] === FROM_FILE_CHOICE) {
		throw new Error('sorry, that feature is not ready yet')
	} else if (answers[askWhichSource.name] in spaces) {
		result.source = spaces[answers[askWhichSource.name]]
	} else if (answers[askWhichSource.name] in teams) {
		result.source = teams[answers[askWhichSource.name]]
	}
	if (answers[askSpaceTitle.name]) {
		result.target = await tools.createSpaceAsModerator({
			title: answers[askSpaceTitle.name],
		})
	}
	if (answers[askTeamName.name]) {
		result.target = await tools.createTeamAsModerator({
			name: answers[askTeamName.name],
		})
	}
	return result
}

const automaticCloneMemberships = async (token, type, source, target) => {
	const tools = ClientTools.fromAccessToken(token) // from process.env
	switch (type) {
	case cloneSpaceIntoFile.name:
		return cloneSpaceIntoFile({ source, target, tools })
	case cloneSpaceIntoSpace.name:
		return cloneSpaceIntoSpace({ source, target, tools })
	case cloneSpaceIntoTeam.name:
		return cloneSpaceIntoTeam({ source, target, tools })
	case cloneTeamIntoFile.name:
		return cloneTeamIntoFile({ source, target, tools })
	case cloneTeamIntoSpace.name:
		return cloneTeamIntoSpace({ source, target, tools })
	case cloneTeamIntoTeam.name:
		return cloneTeamIntoTeam({ source, target, tools })
	default:
		throw new Error(`unknown operation type: ${type}`)
	}
}

const interactiveCloneMemberships = async (token) => {
	const tools = ClientTools.fromAccessToken(token) // from process.env
	const { source, target, type } = await inquireSourceTarget(tools)
	await automaticCloneMemberships(token, type, source, target)
}

if (!module.parent) {
	/* eslint-disable no-console */
	const token = process.env.CISCOSPARK_ACCESS_TOKEN
	if (process.stdout.isTTY) {
		if (!process.env.DEBUG) {
			console.log()
			console.log('\tHeads-up: this script is currently beta-level quality and does some heavy lifting.')
			console.log()
			console.log('\tIf you are really sure you want to run it, add the -d flag to set DEBUG mode on.')
			console.log()
			process.exit() // eslint-disable-line no-process-exit
		}
		console.log()
		console.log('\tPlease wait... (fetching list of all spaces and teams; this might take several seconds)')
		console.log()
		interactiveCloneMemberships(token)
			.catch((error) => {
				console.error(error)
				process.exitCode = 1
			})
	} else {
		automaticCloneMemberships(token)
			.catch((error) => {
				console.error(error)
				process.exitCode = 1
			})
	}
}
