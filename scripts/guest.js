/* eslint-env node */
const SparkTools = require('../support/SparkTools.js');
const jwt = require('jsonwebtoken');

const testGuestService = async (iss, secret, email) => {
    console.log('Composing the token and signing it:');
    const jwtPayload = {
        "sub": "cisco-spark-tools",
        "name": "Cisco Spark Tools",
        "iss": iss
    }
    var jwtToken = jwt.sign(jwtPayload, Buffer.from(secret, 'base64'), { expiresIn: '5m' });
    console.log(jwtToken);

    const loginClient = SparkTools.fromAccessToken();
    console.log('Logging in using by posting signed JWT to: https://api.ciscospark.com/jwt/login');
    const ciToken = await loginClient.jwtLogin(jwtToken)
        .then((res) => {
            console.log('Succesfully logged in. OAuth token expires in', res.expiresIn);
            return res.token;
        })
        .catch((err) => {
            console.error(err);
        });

    console.log('Now sending a message to:', email);
    const sparkClient = SparkTools.fromAccessToken(ciToken);
    await sparkClient.postMessageToEmail(email, 'This is a **test**! Your JWT credentials are working as intended!');
}

module.exports = {
	testGuestService,
}

if (!module.parent) {
    /* eslint-disable no-console */
	const [iss, secret, email] = process.argv.slice(2)
	testGuestService(iss, secret, email);
}