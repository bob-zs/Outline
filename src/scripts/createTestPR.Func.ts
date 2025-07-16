import { Octokit } from "octokit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tokenPath = path.join(__dirname, "..", "..", "/data/token.txt");

if (!fs.existsSync(tokenPath)) {
	throw new Error("❌ GitHub token not found. Run Outline and log in first.");
}

const accessToken = fs.readFileSync(tokenPath, "utf8").trim();
const octokit = new Octokit({ auth: accessToken });

const defaultOwner = "bob-zs";
const defaultRepo = "base-app";
const base = "main";
const branch = `outline-test-${Date.now()}`;
const filePath = "outline-test.txt";

export default async function createTestPR(
	owner = defaultOwner,
	repo = defaultRepo,
) {
	// 1. Get latest commit SHA from base branch
	const { data: refData } = await octokit.rest.git.getRef({
		owner,
		repo,
		ref: `heads/${base}`,
	});
	const baseSha = refData.object.sha;
	console.log({ baseSha });

	// 2. Create new branch
	await octokit.rest.git.createRef({
		owner,
		repo,
		ref: `refs/heads/${branch}`,
		sha: baseSha,
	});

	// 3. Fetch existing file content and sha
	const { data: fileData } = await octokit.rest.repos.getContent({
		owner,
		repo,
		path: filePath,
		ref: base,
	});

	if (!("content" in fileData)) throw new Error("❌ File is not a blob");

	const existingContent = Buffer.from(fileData.content, "base64").toString(
		"utf8",
	);
	const sha = fileData.sha;

	// 4. Append timestamp line
	const timestamp = new Date()
		.toLocaleString("en-US", {
			hour12: true,
			timeZone: "America/New_York",
		})
		.replace(",", "")
		.replace(/:/g, ".");

	const newContent = `${existingContent}\n${timestamp} — Outline test`;

	// 5. Commit updated file to new branch
	await octokit.rest.repos.createOrUpdateFileContents({
		owner,
		repo,
		path: filePath,
		message: `Outline test update at ${timestamp}`,
		content: Buffer.from(newContent).toString("base64"),
		sha,
		branch,
	});

	// 6. Create PR
	const { data: pr } = await octokit.rest.pulls.create({
		owner,
		repo,
		title: `Outline Test PR - ${timestamp}`,
		body: "Automated test PR for Outline pipeline",
		head: branch,
		base,
	});

	console.log(`✅ PR created: ${pr.html_url}`);
}
