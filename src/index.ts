import express from "express";
import { Octokit } from "octokit";
import axios from "axios";
import { config } from "dotenv";

config();
const app = express();
app.use(express.json());

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;

let accessToken = "";
let octokit: Octokit;

const GITHUB_AUTH_HTML_A_TAG = `<a href="https://github.com/login/oauth/authorize?client_id=${client_id}&scope=repo">Login with GitHub</a>`;
app.get("/", (_req, res) => {
	res.send(GITHUB_AUTH_HTML_A_TAG);
});

app.get("/oauth-callback", async (req, res) => {
	const code = req.query.code;

	try {
		const tokenResponse = await axios.post(
			"https://github.com/login/oauth/access_token",
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
		octokit = new Octokit({ auth: accessToken });

		const {
			data: { login },
		} = await octokit.rest.users.getAuthenticated();

		res.send(
			`Hello, ${login}! You can now <a href="/repos">list your repos</a>.`,
		);
	} catch (err) {
		res.status(500).send(`Authentication failed: ${err}`);
	}
});

app.get("/repos", async (_req, res) => {
	try {
		const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser();

		console.log({ repos });
		const enrichedRepos = await Promise.all(
			repos.map(async (repo) => {
				const { data: prs } = await octokit.rest.pulls.list({
					owner: repo.owner.login,
					repo: repo.name,
					state: "open",
				});

				if (repo.name === "actionsAndEnv") {
					console.log({ repo });
				}

				return {
					name: repo.name,
					owner: repo.owner.login,
					full_name: repo.full_name,
					private: repo.private,
					html_url: repo.html_url,
					pr_count: prs.length,
				};
			}),
		);
		// console.log({ enrichedRepos });

		// HTML table display
		const tableRows = enrichedRepos.map(
			(r) => `
							<tr>
									<td><a href="${r.html_url}" target="_blank">${r.name}</a></td>
									<td>${r.full_name}</td>
									<td>${r.private ? "🔒 Private" : "🌐 Public"}</td>
									<td><a href="/repos/${r.owner}/${r.name}/pulls">${r.pr_count} PR${r.pr_count !== 1 ? "s" : ""}</a></td>
							</tr>
					`,
		);

		const html = `
					<html>
					<head><title>Your Repos</title></head>
					<body>
							<h1>🎯 Your GitHub Repos</h1>
							<table border="1" cellpadding="5" cellspacing="0">
									<tr>
											<th>Name</th>
											<th>Full Name</th>
											<th>Visibility</th>
											<th>Open PRs</th>
									</tr>
									${tableRows.join("")}
							</table>
					</body>
					</html>
			`;

		res.send(html);
	} catch (err) {
		res.status(500).send(`Failed to fetch enriched repos: ${err}`);
	}
});

app.get("/repos/:owner/:repo/pulls", async (req, res) => {
	const { owner, repo } = req.params;

	try {
		const { data: pulls } = await octokit.rest.pulls.list({
			owner,
			repo,
			state: "open",
		});

		const enrichedPRs = await Promise.all(
			pulls.map(async (pr) => {
				const { data: prDetails } = await octokit.rest.pulls.get({
					owner,
					repo,
					pull_number: pr.number,
				});

				return {
					title: pr.title,
					number: pr.number,
					html_url: pr.html_url,
					head: pr.head.ref,
					reviewers: prDetails.requested_reviewers.map((r) => r.login),
					mergeable_state: prDetails.mergeable_state,
					ready_to_merge: prDetails.mergeable_state === "clean",
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
