/* eslint-disable no-console */
/* eslint-env node */
const jwt = require('jsonwebtoken')

const ClientTools = require('../support/ClientTools.js')

const toString = any => String(!any || any === 'undefined' ? '' : any)

const testGuestCredentials = async (issuer, secret, email) => {
	console.log('Composing the token and signing it:')

	// https://jwt.io/
	const jwtClaims = {
		'iss': issuer,
		'name': 'Cisco Webex Tools',
		'sub': 'cisco-webex-tools',
	}
	const jwtToken = jwt.sign(jwtClaims, Buffer.from(secret, 'base64'), { expiresIn: '5m' })
	console.log(jwtToken)

	const defaultClient = ClientTools.fromAccessToken()
	console.log('Sending signed JWT to: POST /v1/jwt/login')
	const ciToken = await defaultClient.jwtLogin(jwtToken)
		.then((res) => {
			console.log('Succesfully logged in. OAuth token expires in', res.expiresIn)
			return res.token
		})
		.catch((err) => {
			console.error(err)
		})

	if (!email) {
		const { emails } = await defaultClient.getPersonDetails('me')
		email = emails[0]
	}
	console.log('Now sending a message to:', email)
	const markdown = 'This is a **test**! Your JWT credentials are working as intended!'
	await ClientTools.fromAccessToken(ciToken).postMessageToEmail(email, markdown)
}

module.exports = {
	testGuestCredentials,
}

if (!module.parent) {
	const [issuer, secret, email] = process.argv.slice(2)
	testGuestCredentials(issuer, secret, toString(email))
		.catch((error) => {
			console.error(error)
			process.exitCode = 1
		})
}
