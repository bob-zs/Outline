import express from "express";
import axios from "axios";
import { config } from "dotenv";

config();
const app = express();
const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;

const GITHUB_AUTH_URL = `<a href="https://github.com/login/oauth/authorize?client_id=${client_id}&scope=repo">Login with GitHub</a>`;
app.get("/", (_req, res) => {
	res.send(GITHUB_AUTH_URL);
});

app.get("/oauth-callback", async (req, res) => {
	const code = req.query.code;

	const GITHUB_OAUTH_ACCESS_TOKEN_URL =
		"https://github.com/login/oauth/access_token";
	try {
		const tokenResponse = await axios.post(
			GITHUB_OAUTH_ACCESS_TOKEN_URL,
			{
				client_id,
				client_secret,
				code,
			},
			{
				headers: { accept: "application/json" },
			},
		);

		const accessToken = tokenResponse.data.access_token;
		const GITHUB_USER_URL = "https://api.github.com/user";
		const userResponse = await axios.get(GITHUB_USER_URL, {
			headers: { Authorization: `token ${accessToken}` },
		});

		res.send(`Hello, ${userResponse.data.login}!`);
	} catch (err) {
		res.status(500).send(`Authentication failed: ${err}`);
	}
});

const PORT = 8080;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
