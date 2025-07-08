import express from "express";

const app = express();

app.get("/", (_req, res) => {
	res.send("Hello");
});

const PORT = 8080;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
