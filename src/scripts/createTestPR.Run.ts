import createTestPR from "./createTestPR.Func.js";

createTestPR().catch((err) => {
	console.error("❌ Failed to create test PR:", err);
});
