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

app.use((req, res, next) => {
	// Skip login check for public routes
	if (req.path === "/" || req.path.startsWith("/oauth-callback")) {
		return next();
	}
	if (!accessToken || !octokit) {
		return res.redirect("/");
	}
	next();
});

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

		const enrichedRepos = await Promise.all(
			repos.map(async (repo) => {
				const { data: prs } = await octokit.rest.pulls.list({
					owner: repo.owner.login,
					repo: repo.name,
					state: "open",
				});

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
		const tableRows = enrichedRepos
			.sort((r1, r2) => r2.pr_count - r1.pr_count)
			.map((r) => {
				const repoPullsLink = `<a href="/repos/${r.owner}/${r.name}/pulls">${r.pr_count} PR${r.pr_count !== 1 ? "s" : ""}</a>`;
				return `
							<tr>
									<td><a href="${r.html_url}" target="_blank">${r.name}</a></td>
									<td>${r.full_name}</td>
									<td>${r.private ? "🔒 Private" : "🌐 Public"}</td>
									<td>${r.pr_count > 0 ? repoPullsLink : `0 PRs`}</td>
							</tr>
					`;
			});

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

		const tableRows = enrichedPRs.map(
			(pr) => `
                <tr>
                    <td><a href="${pr.html_url}" target="_blank">#${pr.number} - ${pr.title}</a></td>
                    <td>${pr.head}</td>
                    <td>${pr.reviewers.join(", ") || "None"}</td>
                    <td>${pr.mergeable_state}</td>
                    <td>${pr.ready_to_merge ? "✅ Ready" : "❌ Not Ready"}</td>
                </tr>
            `,
		);

		const html = `
            <html>
            <head><title>Pull Requests</title></head>
            <body>
                <h2>🔍 Open PRs for ${owner}/${repo}</h2>
                <table border="1" cellpadding="5" cellspacing="0">
                    <tr>
                        <th>Title</th>
                        <th>Branch</th>
                        <th>Reviewers</th>
                        <th>Mergeable State</th>
                        <th>Ready to Merge?</th>
                    </tr>
                    ${tableRows.join("")}
                </table>
                <p><a href="/repos">⬅ Back to Repos</a></p>
            </body>
            </html>
        `;

		res.send(html);
	} catch (err) {
		res.status(500).send(`Failed to fetch enriched PRs: ${err}`);
	}
});

const PORT = 8080;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
