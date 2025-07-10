import express from "express";
import axios from "axios";
import { config } from "dotenv";

config();
const app = express();
app.use(express.json());

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;

let accessToken = "";

const GITHUB_AUTH_HTML_A_TAG = `<a href="https://github.com/login/oauth/authorize?client_id=${client_id}&scope=repo">Login with GitHub</a>`;
app.get("/", (_req, res) => {
	res.send(GITHUB_AUTH_HTML_A_TAG);
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

		accessToken = tokenResponse.data.access_token;

		const GITHUB_USER_URL = "https://api.github.com/user";
		const userResponse = await axios.get(GITHUB_USER_URL, {
			headers: { Authorization: `token ${accessToken}` },
		});

		res.send(
			`Hello, ${userResponse.data.login}! You can now <a href="/repos">list your repos</a>.`,
		);
	} catch (err) {
		res.status(500).send(`Authentication failed: ${err}`);
	}
});

app.get("/repos", async (_req, res) => {
	console.log({ accessToken });
	try {
		const GITHUB_REPOS_ENDPOINT = "https://api.github.com/user/repos";
		const repoResponse = await axios.get(GITHUB_REPOS_ENDPOINT, {
			headers: { Authorization: `token ${accessToken}` },
		});

		const repos = repoResponse.data.map((repo) => ({
			name: repo.name,
			full_name: repo.full_name,
			private: repo.private,
			html_url: repo.html_url,
			link: `<a href=${repo.html_url}>Link</a>`,
		}));

		res.json(repos);
	} catch (err) {
		res.status(500).send(`Failed to fetch repos: ${err}`);
	}
});

app.get("/repos/:owner/:repo/pulls", async (req, res) => {
	const { owner, repo } = req.params;

	try {
		const pullsResponse = await axios.get(
			`https://api.github.com/repos/${owner}/${repo}/pulls`,
			{ headers: { Authorization: `token ${accessToken}` } },
		);

		const enrichedPRs = await Promise.all(
			pullsResponse.data.map(async (pr) => {
				const prDetails = await axios.get(
					`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}`,
					{ headers: { Authorization: `token ${accessToken}` } },
				);

				return {
					title: pr.title,
					number: pr.number,
					html_url: pr.html_url,
					head: pr.head.ref,
					reviewers: prDetails.data.requested_reviewers.map((r) => r.login),
					mergeable_state: prDetails.data.mergeable_state,
					ready_to_merge: prDetails.data.mergeable_state === "clean",
				};
			}),
		);

		res.json(enrichedPRs);
	} catch (err) {
		res.status(500).send(`Failed to fetch enriched PRs: ${err}`);
	}
});

const PORT = 8080;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
