/* eslint-env mocha */
const assert = require('assert')

const UUID = require('uuid')

const SparkTools = require('./SparkTools.js')

describe('SparkTools', () => {

	const newSparkTools = async (...args) => new SparkTools(...args)

	describe('constructor', () => {

		it('will throw TypeError if not provided a Bearer token', async () => {
			const error = await newSparkTools().catch(error => error)
			assert(error instanceof TypeError, 'expected TypeError thrown')
			assert(error.message.includes('export CISCOSPARK_ACCESS_TOKEN'), 'expected mention of env')
			assert(error.message.includes('dev.ciscospark.com'), 'expected mention of developer portal')
		})

	})

	describe('internals', () => {

		const base64urlID = (middle, suffix = `/${UUID.v1()}`, prefix = 'ciscospark://us/') => {
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

		const fakeResponse = (body, status = 200) => {
			const json = async () => body
			return Object.freeze({ json, status })
		}

		const fake = Object.assign({}, fakeResources(), {
			token: 'usually CISCOSPARK_ACCESS_TOKEN',
		})

		before(async () => {
			fake.tools = await newSparkTools(fake.token)
			fake.tools.fetch = async () => fakeResponse()
		})

		it('#getPerson defaults to GET /v1/people/me', async () => {
			fake.tools.fetch = async () => fakeResponse(fake.person)
			const person = await fake.tools.getPerson()
			assert.deepStrictEqual(person, fake.person)
		})

		const test = (inputJSON, methodName, ...args) => {
			it(`#${methodName} (id: ${UUID.v4()})`, async () => {
				fake.tools.fetch = async () => fakeResponse(inputJSON)
				const outputJSON = await fake.tools[methodName](...args)
				assert.deepStrictEqual(inputJSON, outputJSON)
			})
		}

		test(fake.person, 'getPerson', fake.person.id)
		//test(fake.team, 'getTeam', fake.team.id)

	})

})
