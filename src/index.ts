import express from "express";
import { Octokit } from "octokit";
import axios from "axios";
import { config } from "dotenv";

import { fileURLToPath } from "url";
import path from "path";

import { spawn } from "child_process";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();
const app = express();
app.use(express.json());

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;

let accessToken = "";
let octokit: Octokit;

const TOKEN_PATH = path.join(__dirname, "../data/token.txt");
// If we already have a token on disk, load it
if (fs.existsSync(TOKEN_PATH)) {
	accessToken = fs.readFileSync(TOKEN_PATH, "utf8").trim();
	octokit = new Octokit({ auth: accessToken });
}

// In-memory store for dispatched runs and logs
const trackedRuns: {
	run_id: number;
	owner: string;
	repo: string;
	pr_number: number;
	status: string;
	conclusion?: string;
	logs: string[];
}[] = [];

app.use((req, res, next) => {
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
			{ client_id, client_secret, code },
			{ headers: { accept: "application/json" } },
		);

		accessToken = tokenResponse.data.access_token;
		fs.writeFileSync(TOKEN_PATH, accessToken, "utf8");

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

const TEST_FOCUSED_REPOS = ["base-app"];
app.get("/repos", async (_req, res) => {
	try {
		const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser();

		console.log({});
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
			.filter((r) => TEST_FOCUSED_REPOS.includes(r.name)) //
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
				const run = trackedRuns.find(
					(r) =>
						r.repo === repo && r.owner === owner && r.pr_number === pr.number,
				);

				const statusIndicator = run
					? run.status === "completed"
						? run.conclusion === "success"
							? "✅ Success"
							: "❌ Failed"
						: "🔄 Running"
					: "⏳ Not started";

				return {
					title: pr.title,
					number: pr.number,
					html_url: pr.html_url,
					head: pr.head.ref,
					reviewers: pr.requested_reviewers.map((r) => r.login),
					mergeable_state: pr.mergeable_state,
					ready_to_merge: pr.mergeable_state === "clean",
					statusIndicator,
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
					<td>${pr.statusIndicator}</td>
					<td>
						<form method="POST" action="/repos/${owner}/${repo}/pulls/${pr.number}/dispatch">
							<button type="submit">🚀 Run Workflow</button>
						</form>
					</td>
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
						<th>Status</th>
						<th>Actions</th>
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

async function runJob({
	owner,
	repo,
	branch,
	pr_number,
	stages,
}: {
	owner: string;
	repo: string;
	branch: string;
	pr_number: number;
	stages: string[];
}) {
	const jobId = Date.now();
	const repoDir = path.join(__dirname, "jobs", `${repo}-${jobId}`);
	fs.mkdirSync(repoDir, { recursive: true });

	const logs: string[] = [];

	function log(message: string) {
		logs.push(message);
		console.log(`[Job ${jobId}] ${message}`);
	}

	log(`Cloning ${owner}/${repo}...`);
	await new Promise((resolve, reject) => {
		const git = spawn("git", [
			"clone",
			`https://github.com/${owner}/${repo}.git`,
			repoDir,
		]);
		git.on("close", (code) => (code === 0 ? resolve(null) : reject(code)));
	});

	log(`Checking out branch ${branch}...`);
	await new Promise((resolve, reject) => {
		const checkout = spawn("git", ["checkout", branch], { cwd: repoDir });
		checkout.on("close", (code) => (code === 0 ? resolve(null) : reject(code)));
	});

	for (const stage of stages) {
		log(`Running stage: ${stage}`);
		await new Promise((resolve) => {
			const proc = spawn("bash", [`.github/scripts/${stage}.sh`], {
				cwd: repoDir,
			});
			proc.stdout.on("data", (data) => log(data.toString()));
			proc.stderr.on("data", (data) => log(data.toString()));
			proc.on("close", () => resolve(null));
		});
	}

	await octokit.rest.pulls.merge({
		owner,
		repo,
		pull_number: pr_number,
		merge_method: "squash",
	});

	log(`✅ Job complete`);
	return { jobId, logs };
}

app.post("/repos/:owner/:repo/pulls/:number/dispatch", async (req, res) => {
	const { owner, repo, number } = req.params;

	const { data: pr } = await octokit.rest.pulls.get({
		owner,
		repo,
		pull_number: parseInt(number),
	});

	const stages = ["build", "deploy-staging", "e2e", "deploy-prod", "merge"];
	const job = await runJob({
		owner,
		repo,
		branch: pr.head.ref,
		pr_number: pr.number,
		stages,
	});

	trackedRuns.push({
		run_id: job.jobId,
		owner,
		repo,
		pr_number: pr.number,
		status: "completed",
		conclusion: "success",
		logs: job.logs,
	});

	res.send(`✅ Job ${job.jobId} completed for PR #${pr.number}`);
	res.send(`
✅ Job ${job.jobId} completed for PR #${pr.number}  
<p><a href="/jobs/${job.jobId}">▶️ View job details & logs</a></p>
<p><a href="/jobs">🗂️ View all jobs</a></p>
`);
});

app.post("/logs", (req, res) => {
	const { run_id, step, message } = req.body;
	const run = trackedRuns.find((r) => r.run_id === Number(run_id));
	if (run) {
		run.logs.push(`[${step}] ${message}`);
		console.log(`[Run ${run_id}] [${step}] ${message}`);
	}
	res.sendStatus(200);
});

// Polling loop to update run status
setInterval(async () => {
	for (const run of trackedRuns) {
		if (run.status === "completed") continue;

		try {
			const { data } = await octokit.rest.actions.getWorkflowRun({
				owner: run.owner,
				repo: run.repo,
				run_id: run.run_id,
			});

			run.status = data.status;
			run.conclusion = data.conclusion;

			if (data.status === "completed") {
				console.log(
					`✅ Run ${run.run_id} for ${run.owner}/${run.repo} completed with ${data.conclusion}`,
				);
			}
		} catch (err) {
			console.error(`Failed to poll run ${run.run_id}: ${err}`);
		}
	}
}, 5000);

// 1) List all jobs with links
app.get("/jobs", (_req, res) => {
	const rows = trackedRuns
		.map(
			(run) => `
      <tr>
        <td><a href="/jobs/${run.run_id}">${run.run_id}</a></td>
        <td>${run.owner}/${run.repo}#${run.pr_number}</td>
        <td>${
					run.status === "completed"
						? run.conclusion === "success"
							? "✅ Success"
							: "❌ Failed"
						: "🔄 Running"
				}</td>
      </tr>
    `,
		)
		.join("");

	res.send(`
    <html><body>
      <h1>🛠️ All Jobs</h1>
      <table border="1" cellpadding="5" cellspacing="0">
        <tr><th>Job ID</th><th>Repo & PR</th><th>Status</th></tr>
        ${rows}
      </table>
      <p><a href="/repos">⬅ Back to Repos</a></p>
    </body></html>
  `);
});

// 2) Show details + logs for a single job
app.get("/jobs/:run_id", (req, res) => {
	const runId = Number(req.params.run_id);
	const run = trackedRuns.find((r) => r.run_id === runId);
	if (!run) return res.status(404).send("Job not found");

	// join logs into a <pre> block
	const logContent = run.logs
		.map((line) => line.replace(/</g, "&lt;"))
		.join("\n");
	res.send(`
    <html><body>
      <h1>🛠️ Job ${runId}</h1>
      <p><strong>Repo:</strong> ${run.owner}/${run.repo}</p>
      <p><strong>PR #:</strong> ${run.pr_number}</p>
      <p><strong>Status:</strong> ${
				run.status === "completed"
					? run.conclusion === "success"
						? "✅ Success"
						: "❌ Failed"
					: "🔄 Running"
			}</p>
      <h2>Logs</h2>
      <pre style="background:#f4f4f4; padding:10px; white-space:pre-wrap;">${logContent}</pre>
      <p><a href="/jobs">⬅ Back to Jobs</a></p>
    </body></html>
  `);
});

const PORT = 8080;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
