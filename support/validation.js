const querystring = require('querystring')

const joi = require('joi')
const _ = require('lodash')

const buildSchema = _.once(() => {

	const idString = (/* should validate resource type */) => joi.alternatives()
		.try(joi.string().uuid(), joi.string().base64({ paddingRequired: false }))

	const listEvents = joi.object()
		.keys({
			actorId: idString('PEOPLE'),
			from: joi.date().iso(),
			max: joi.number().integer().min(1).max(1000),
			resource: joi.string().valid('memberships', 'messages'),
			to: joi.date().iso(),
			type: joi.string().valid('created', 'deleted', 'updated'),
		})

	// both space and team memberships
	const listMemberships = joi.object()
		.keys({
			max: joi.number().integer().min(1).max(1000),
		})

	const listMessages = joi.object()
		.keys({
			before: joi.date().iso(),
			beforeMessage: idString('MESSAGE'),
			max: joi.number().integer().min(1).max(1000),
			mentionedPeople: joi.array().items('me', idString('PEOPLE')).single(),
			roomId: idString('ROOM').required(),
		})

	const listPeople = joi.object()
		.keys({
			displayName: joi.string().min(3).max(20),
			email: joi.string().email(),
			id: joi.array().items(idString('PEOPLE')).max(85).single(),
			max: joi.number().integer().min(1).max(1000),
			orgId: idString('ORGANIZATION'),
		})

	const listSpaceMemberships = listMemberships
		.keys({
			personEmail: joi.string().email(),
			personId: idString('PEOPLE'),
			roomId: idString('ROOM'),
		})

	const listSpaces = joi.object()
		.keys({
			max: joi.number().integer().min(1).max(1000),
			sortBy: joi.string().valid('created', 'id', 'lastactivity'),
			teamId: idString('TEAM'), // totally optional
			type: joi.string().valid('direct', 'group'),
		})

	const listTeamMemberships = listMemberships
		.keys({
			teamId: idString('TEAM').required(),
		})

	const listTeams = joi.object()
		.keys({
			max: joi.number().integer().min(1).max(1000),
		})

	const listWebhooks = joi.object()
		.keys({
			max: joi.number().integer().min(1).max(100),
		})

	return Object.freeze({
		'/v1/events': listEvents,
		'/v1/memberships': listSpaceMemberships,
		'/v1/messages': listMessages,
		'/v1/people': listPeople,
		'/v1/room/memberships': listSpaceMemberships,
		'/v1/rooms': listSpaces,
		'/v1/space/memberships': listSpaceMemberships,
		'/v1/spaces': listSpaces,
		'/v1/team/memberships': listTeamMemberships,
		'/v1/teams': listTeams,
		'/v1/webhooks': listWebhooks,
	})

})

const rewriteError = ({ message: oldMessage, stack }) => {
	const matches = /^child "(.*?)" fails because \[(.*)\]$/.exec(oldMessage)
	return Object.assign(new Error(_.get(matches, 2, oldMessage)), { stack })
}

const rewriteURI = (baseURI, queryOptions, defaultScheme) => {
	const scheme = _.get(buildSchema(), baseURI, defaultScheme)
	if (!scheme) return baseURI // no query options to validate
	const { error, value } = joi.validate(queryOptions, scheme)
	if (error) throw rewriteError(error) // use joi options?
	return `${baseURI}?${querystring.stringify(value)}`
}

module.exports = {
	buildURI: rewriteURI,
	schema: buildSchema(),
}
