/* eslint-env mocha */
const assert = require('assert')

const { Response } = require('node-fetch')
const { v4: randomUUID } = require('uuid')

const SparkTools = require('../support/SparkTools.js')

describe('SparkTools', () => {

	const newSparkTools = async (...args) => new SparkTools(...args)

	describe('constructor', () => {

		it('will throw TypeError if not provided a Bearer token', async () => {
			const error = await newSparkTools('').catch(thrownError => thrownError)
			assert(error instanceof TypeError, 'expected TypeError thrown due to empty token')
			assert(error.message.includes('export CISCOSPARK_ACCESS_TOKEN'), 'expected mention of env')
			assert(error.message.includes('dev.ciscospark.com'), 'expected mention of developer portal')
		})

	})

	describe('internals', () => {

		const base64urlID = (middle, suffix = `/${randomUUID()}`, prefix = 'ciscospark://us/') => {
			const id = Buffer.from([prefix, middle, suffix].join('')).toString('base64')
			return id.replace('/', '_').replace('+', '-').replace(/=+$/, '')
		}

		const fakeResource = (type, id = base64urlID(type), ...args) => {
			const created = new Date().toISOString() // won't match UUID
			return Object.freeze(Object.assign({ created, id }, ...args))
		}

		const fakeResources = () => {
			// N.B. these are all strict subsets of real ones
			const fakeMessage = fakeResource('MESSAGE', {
				text: 'Fake Message',
			})
			const fakePerson = fakeResource('PERSON', {
				displayName: 'Fake Person'
			})
			const fakeRoom = fakeResource('ROOM', {
				title: 'Fake Room',
			})
			const fakeWebhook = fakeResource('WEBHOOK', {
				name: 'Fake Webhook',
			})
			const fakeTeam = fakeResource('TEAM', {
				name: 'Fake Team',
			})
			return {
				membership: fakeResource('TEAM_MEMBERSHIP', {
					personId: fakePerson.id,
					teamId: fakeTeam.id,
				}),
				message: fakeMessage,
				person: fakePerson,
				room: fakeRoom,
				team: fakeTeam,
				webhook: fakeWebhook,
			}
		}

		const fake = Object.assign({}, fakeResources(), {
			token: 'usually CISCOSPARK_ACCESS_TOKEN',
		})

		const okResponse = body => new Response(typeof body === 'string' ? body.slice() : JSON.stringify(body), { status: 200 })

		before(async () => {
			fake.tools = await newSparkTools(fake.token)
			fake.tools.fetch = async () => new Response()
		})

		it('#getPersonDetails defaults to GET /v1/people/me', async () => {
			fake.tools.fetch = async () => okResponse(fake.person)
			const person = await fake.tools.getPersonDetails()
			assert.deepStrictEqual(person, fake.person)
		})

		const test = (inputJSON, methodName, ...args) => {
			it(`#${methodName} (id: ${randomUUID()})`, async () => {
				fake.tools.fetch = async () => okResponse(inputJSON)
				const outputJSON = await fake.tools[methodName](...args)
				assert.deepStrictEqual(inputJSON, outputJSON)
			})
		}

		test(fake.person, 'getPersonDetails', fake.person.id)
		//test(fake.team, 'getTeamDetails', fake.team.id)

	})

})
