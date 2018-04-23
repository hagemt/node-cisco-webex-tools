const { URL } = require('url')

const _ = require('lodash')
const fetch = require('node-fetch')

const ClientError = require('./ClientError.js')
const log = require('./log.js') // DEBUG support
const PACKAGE_JSON = require('../package.json')
const validation = require('./validation.js')

const USER_AGENT_PREFIX = `${PACKAGE_JSON.name}/${PACKAGE_JSON.version} (+${PACKAGE_JSON.bugs.url})`
const USER_AGENT_SUFFIX = `${process.release.name}/${process.version} ${process.platform}/${process.arch}`

const DEFAULT_HEADERS = Object.freeze({
	'user-agent': `${USER_AGENT_PREFIX} ${USER_AGENT_SUFFIX}`,
})

// TODO (tohagema): these contain "ciscospark" which will need to change...
const { CISCOSPARK_ACCESS_TOKEN, CISCOSPARK_URL_ORIGIN } = Object(process.env)
const DEFAULT_ORIGIN = String(CISCOSPARK_URL_ORIGIN || 'https://api.ciscospark.com')
const FEATURE_ORIGIN = process.env.FEATURE_ORIGIN || 'https://feature.a6.ciscospark.com'
const buildURL = (string, origin = DEFAULT_ORIGIN) => new URL(string, origin).toString()

const JSON_MIME = 'application/json'
const JSON_HEADERS = Object.freeze({
	'accept': JSON_MIME,
	'content-type': JSON_MIME,
})

const base64url = (...args) => {
	const buffer = Buffer.from(...args).toString('base64') // [+/=] => [-_]
	return buffer.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const decodeID = (encoded, encoding = 'base64') => {
	const decoded = Buffer.from(encoded, encoding).toString()
	return decoded.slice(decoded.lastIndexOf('/') + 1)
}

const authorizations = new WeakMap() // private mechanism to obtain the header, by instance
const createdDate = ({ created }) => created ? new Date(created) : new Date() // default: now
const MOST_RECENTLY_CREATED_FIRST = (lhs, rhs) => Math.sign(createdDate(rhs) - createdDate(lhs))

/**
 * Make requests and parse responses from Cisco Webex for Developers. Add methods to support scripts.
 *
 * Try to follow conventions of existing methods, and delegate/re-use when it makes sense to do so.
 *
 * To ignore auto-page/retry mechanism(s), specify page/retry: false (in options or on class instances)
 *
 * As a general rule, try to remain orderly: don't add unnecessary plumbing, and keep porcelian consistent.
 */
class ClientTools {

	// constructor signature is volatile; use static factory methods
	constructor (userAccessToken = CISCOSPARK_ACCESS_TOKEN) {
		if (!userAccessToken || typeof userAccessToken !== 'string') {
			throw new TypeError('export CISCOSPARK_ACCESS_TOKEN=... # from dev.ciscospark.com')
		}
		authorizations.set(this, `Bearer ${userAccessToken}`)
		this.json = async (uri, options) => {
			const authorization = authorizations.get(this) // can override this via options:Object's headers:Object
			const requestURL = buildURL(uri, _.get(options, 'url')) // will use DEFAULT_ORIGIN if options.url undefined
			const headers = Object.assign({ authorization }, DEFAULT_HEADERS, JSON_HEADERS, _.get(options, 'headers'))
			const request = Object.assign({ method: 'GET', page: true, retry: true }, options, { headers, url: requestURL })
			if (typeof request.body === 'object') request.body = JSON.stringify(request.body)
			const response = await this.fetch(request.url, request)
			switch (response.status) {
			case 200: // OK
				if (!this.page || !request.page || !response.headers.has('link')) {
					return response.json() // can't or won't (so don't) auto-page
				}
				return this.page(response, request)
			case 201: // Created
				return response.json()
			case 204: // No Content
				return
			case 401: // Unauthorized
				throw new ClientError(`access token is invalid (authorize/set a new token via ${PACKAGE_JSON.name} tutorial)`)
			case 429: // Too Many Requests
			case 503: // Service Unavailable
				if (!this.retry || !request.retry || !response.headers.has('retry-after')) {
					throw new ClientError(`sent too many requests (response status: ${response.status}) and cannot retry`)
				}
				return ClientError.retryAfter(response.headers.get('retry-after'), async () => this.json(uri, options))
			default:
				throw await ClientError.fromResponse(response).catch(nonClientError => nonClientError)
			}
		}
		this.log = (format, ...args) => log.debug(format, ...args)
		this.log.debug = this.log // prefer this alias, in future
		this.page = async (response, request, array = []) => {
			const { items } = await response.json()
			for (const item of items) array.push(item)
			const linkHeader = response.headers.get('link')
			const nextURLs = /<(.+?)>; rel="next"/g.exec(linkHeader)
			const nextURL = _.get(nextURLs, 1) // may be undefined
			if (!nextURL) return { items: array } // only page items
			const next = await this.fetch(nextURL, {
				headers: request.headers, // same auth, etc.
			})
			return this.page(next, request, array)
		}
	}

	/* istanbul ignore next */
	async fetch (url, options) {
		const hrtime = process.hrtime()
		const response = await fetch(url, options).catch(error => error)
		const [s, ns] = process.hrtime(hrtime)
		// e.g. GET /v1/people/me => 200 OK (in 0.200s)
		this.log.debug(
			'fetch: %s %s => %s %s (in %ss)',
			String(_.get(options, 'method', 'GET')),
			url, // N.B. fetch ignores options.url
			String(Number(response.status) || 0),
			ClientError.statusMessage(response),
			Number(s + ns / 1e9).toFixed(3),
		)
		if (response instanceof Error) throw response
		return response // may or may not be 200 OK
	}

	async addMembershipToSpace (space, ...args) {
		const { isModerator, personEmail } = Object.assign({}, space, ...args)
		if (!personEmail) throw new Error('missing person email')
		const roomId = _.get(space, 'id', space)
		if (!roomId) throw new Error('missing space id')
		this.log.debug(
			'add (moderator: %s) participant (email: %s) to space (id: %s)',
			isModerator ? 'true' : 'false',
			personEmail,
			roomId,
		)
		return this.json('/v1/memberships', {
			body: { isModerator, personEmail, roomId },
			method: 'POST',
		})
	}

	async addMembershipToTeam (team, ...args) {
		const { isModerator, personEmail } = Object.assign({}, team, ...args)
		if (!personEmail) throw new Error('missing person email')
		const teamId = _.get(team, 'id', team)
		if (!teamId) throw new Error('missing team id')
		this.log.debug(
			'add (moderator: %s) participant (email: %s) to team (id: %s)',
			isModerator ? 'true' : 'false',
			personEmail,
			teamId,
		)
		return this.json('/v1/team/memberships', {
			body: { isModerator, personEmail, teamId },
			method: 'POST',
		})
	}

	async createTeamAsModerator (...args) {
		const { name } = Object.assign({}, ...args)
		if (!name) throw new Error('missing team name')
		this.log.debug('create team (name: %s)', name)
		return this.json('/v1/teams', {
			body: { name },
			method: 'POST',
		})
	}

	async getPersonDetails (person = 'me') {
		const id = _.get(person, 'id', person)
		if (!id) throw new Error('missing person id')
		return this.json(`/v1/people/${id}`)
	}

	async getTeamDetails (team) {
		const id = _.get(team, 'id', team)
		if (!id) throw new Error('missing team id')
		return this.json(`/v1/teams/${id}`)
	}

	async getTeamMembership (team, person) {
		const personUUID = decodeID(_.get(person, 'id', person))
		const teamUUID = decodeID(_.get(team, 'id', team))
		if (!personUUID) throw new Error('missing person id')
		if (!teamUUID) throw new Error('missing team id')
		const id = base64url(`ciscospark://us/TEAM_MEMBERSHIP/${personUUID}:${teamUUID}`)
		return this.json(`/v1/team/memberships/${id}`)
	}

	async listEvents (...args) {
		const input = Object.assign({ max: 1000 }, ...args)
		const uri = validation.buildURI('/v1/events', input)
		const options = _.pick(input, ['page', 'retry'])
		const { items } = await this.json(uri, options)
		return items
	}

	async listMemberships (...args) {
		// by default: will list own SPACE memberships
		// TODO (tohagema): allow type=direct,group,team?
		const input = Object.assign({ max: 1000 }, ...args)
		const uri = validation.buildURI('/v1/memberships', input)
		const options = _.pick(input, ['page', 'retry'])
		const { items } = await this.json(uri, options)
		return items
	}

	async listMessages (space, ...args) {
		const roomId = _.get(space, 'space.id', _.get(space, 'id', space))
		const input = Object.assign({ max: 1000, roomId }, ...args)
		const uri = validation.buildURI('/v1/messages', input)
		const options = _.pick(input, ['page', 'retry'])
		const { items } = await this.json(uri, options)
		return items
	}

	async listPeople (...args) {
		const input = Object.assign({ max: 1000 }, ...args)
		const uri = validation.buildURI('/v1/people', input)
		const options = _.pick(input, ['page', 'retry'])
		const { items } = await this.json(uri, options)
		return items
	}

	async listSpaceMemberships (space, ...args) {
		const roomId = _.get(space, 'space.id', _.get(space, 'id', space))
		const input = Object.assign({ max: 1000, roomId }, ...args)
		const uri = validation.buildURI('/v1/space/memberships', input)
		const options = _.pick(input, ['page', 'retry'])
		const { items } = await this.json(uri, options)
		return items
	}

	async listSpaces (...args) {
		const input = Object.assign({ max: 1000 }, ...args)
		const uri = validation.buildURI('/v1/spaces', input)
		const options = _.pick(input, ['page', 'retry'])
		const { items } = await this.json(uri, options)
		return items
	}

	async listTeamMemberships (team, ...args) {
		const teamId = _.get(team, 'team.id', _.get(team, 'id', team))
		const input = Object.assign({ max: 1000, teamId }, ...args)
		const uri = validation.buildURI('/v1/team/memberships', input)
		const options = _.pick(input, ['page', 'retry'])
		const { items } = await this.json(uri, options)
		return items
	}

	async listTeams (...args) {
		const input = Object.assign({ max: 1000 }, ...args)
		const uri = validation.buildURI('/v1/teams', input)
		const options = _.pick(input, ['page', 'retry'])
		const { items } = await this.json(uri, options)
		return items
	}

	async listWebhooks (...args) {
		const input = Object.assign({ max: 100 }, ...args)
		const uri = validation.buildURI('/v1/webhooks', input)
		const options = _.pick(input, ['page', 'retry'])
		const { items } = await this.json(uri, options)
		return items
	}

	async listTeamsModeratedByMe (...args) {
		const teams = await this.listTeams(...args)
		const me = await this.getPersonDetails('me')
		const isModerator = await Promise.all(teams.map(async (team) => {
			const myTeamMembership = await this.getTeamMembership(team, me)
			return myTeamMembership.isModerator // if false, team filtered out
		}))
		return teams.filter((team, index) => isModerator[index]).sort(MOST_RECENTLY_CREATED_FIRST)
	}

	async pingFeatureService (originURL = FEATURE_ORIGIN, pingURI = '/feature/api/v1/ping') {
		const headers = Object.assign({ authorization: authorizations.get(this) }, DEFAULT_HEADERS, JSON_HEADERS)
		const response = await this.fetch(buildURL(pingURI, originURL), { headers })
		if (!response.ok) throw new Error(await response.text())
		// should probably parse response body for real status
	}

	async listDeveloperFeatures (keys = [], person = 'me') {
		const keyStrings = Array.from(keys, any => String(any || '')) // will be validated:
		const keysUnique = Array.from(new Set(keyStrings.filter(nonEmpty => !!nonEmpty)))
		if (keyStrings.length !== keysUnique.length) throw new Error('invalid feature names')
		const headers = Object.assign({ authorization: authorizations.get(this) }, DEFAULT_HEADERS, JSON_HEADERS)
		const { id } = await this.getPersonDetails(person) // usually 'me' (for user's own developer feature flags)
		const developerURL = buildURL(`/feature/api/v1/features/users/${decodeID(id)}/developer`, FEATURE_ORIGIN)
		if (keysUnique.length === 0) {
			const response = await this.fetch(developerURL, { headers }) // returns object w/ list of all toggles
			if (!response.ok) throw new Error(`GET ${developerURL} => ${response.status} ${response.statusText}`)
			const { featureToggles } = await response.json() // doesn't appear to support/require any page logic
			return featureToggles
		}
		const fetchFeature = key => this.fetch(`${developerURL}/${key}`, { headers }).catch(error => error)
		const responses = await Promise.all(Array.from(keysUnique, fetchFeature)) // send/recv req/res in parallel
		if (!responses.some(response => !response.ok)) return Promise.all(responses.map(response => response.json()))
		const responseMessages = responses.map(response => response instanceof Error ? response.message : response.statusText)
		throw new Error(`GET ${developerURL}/{${keysUnique.join()}} => {${responseMessages.join()}} (one or more fetch failures)`)
	}

	async setDeveloperFeature (key, value = true, mutable = true, person = 'me') {
		const { id } = await this.getPersonDetails(person) // usually 'me' (for own developer feature flags)
		const developerURL = buildURL(`/feature/api/v1/features/users/${decodeID(id)}/developer`, FEATURE_ORIGIN)
		const headers = Object.assign({ authorization: authorizations.get(this) }, DEFAULT_HEADERS, JSON_HEADERS)
		const body = { key: String(key || ''), mutable: String(mutable || false), val: String(value || false) }
		const response = await this.fetch(developerURL, { body: JSON.stringify(body), headers, method: 'POST' })
		if (response.ok) return response.json()
		throw new Error(await response.text())
	}

	async jwtLogin (token) {
		const response = await this.fetch(buildURL('/v1/jwt/login'), {
			headers: { authorization: `Bearer ${token}` },
			method: 'POST',
		})
		if (response.ok) return response.json()
		throw new Error(await response.text())
	}

	async postMessageToEmail (email, message) {
		this.log.debug('posting message to: %s', email)
		return this.json('/v1/messages', {
			body: {
				markdown: message,
				toPersonEmail: email,
			},
			method: 'POST',
		})
	}

	static fromAccessToken (token) {
		return new ClientTools(token)
	}

}

module.exports = ClientTools
