/* eslint-env node */
//const { URL } = require('url')

//const inquirer = require('inquirer')

const SparkTools = require('../support/SparkTools.js')

/*
const askFeatureService = async (key, value) => {
	await pingFeatureService()
	const user = await getUserUUID()
	if (!key) return getDeveloperFeatures(user)
	if (!value) return getDeveloperFeature(user, key)
	return setDeveloperFeature(user, key, value)
}
*/

if (!module.parent) {
	/* eslint-disable no-console */
	SparkTools.fromAccessToken()
		//.pingFeatureService() // no result
		//.listDeveloperFeatures() // all results
		.setDeveloperFeature('events-api') // default: true
		//.listDeveloperFeatures({ keys: ['events-api'], person: 'me' })
		.then((result) => {
			console.log('result:', JSON.stringify(result, null, '\t'))
		})
		.catch((reason) => {
			console.error(reason)
			process.exitCode = 1
		})
}
