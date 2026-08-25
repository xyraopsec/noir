// NOIR cloud start — generates config.json from env vars, then boots server
const fs = require("fs");
const path = require("path");

const WORKSPACE = path.join(__dirname, "workspace");
fs.mkdirSync(WORKSPACE, { recursive: true });

const config = {
  port: parseInt(process.env.PORT || "3000"),
  accessCodes: {
    "K9M-Q2X": { role: "owner", label: "Owner" },
    "V4T-7RB": { role: "friend", label: "David S" },
    "D8H-3NW": { role: "friend", label: "David R" },
    "P6C-5YK": { role: "friend", label: "Lisian" },
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    secret: process.env.GOOGLE_SECRET || "noir-prod-secret",
    allowlist: [
      "andi.selmani@stud.sek-ds.ch",
      "david.salgado@stud.sek-ds.ch",
      "david.rosario@stud.sek-ds.ch",
      "lisian.ademi@stud.sek-ds.ch",
      "matteo.retortillo@stud.sek-ds.ch",
    ],
  },
  providers: {
    openrouter: { apiKey: process.env.OPENROUTER_API_KEY || "" },
    groq: { apiKey: process.env.GROQ_API_KEY || "" },
    gemini: { apiKey: process.env.GEMINI_API_KEY || "" },
    cerebras: { apiKey: process.env.CEREBRAS_API_KEY || "" },
    nvidia: { apiKey: process.env.NVIDIA_API_KEY || "" },
    mistral: { apiKey: process.env.MISTRAL_API_KEY || "" },
  },
  models: [
    { id: "auto", name: "Auto", provider: "router", ctx: 100000 },
    { id: "google/gemini-3.7-flash-preview", name: "Gemini 3.7 Flash", provider: "gemini", ctx: 1048576, aliases: ["fast"] },
    { id: "google/gemini-3.5-flash-preview", name: "Gemini 3.5 Flash", provider: "gemini", ctx: 1048576 },
    { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B", provider: "openrouter", ctx: 131072, aliases: ["vision", "free"] },
    { id: "meta-llama/llama-3.2-90b-vision-instruct:free", name: "Llama 3.2 90B Vision", provider: "nvidia", ctx: 131072 },
    { id: "qwen/qwen3-coder-480b-a35b-instruct:free", name: "Qwen3 Coder 480B", provider: "openrouter", ctx: 262144, aliases: ["smart", "code"] },
    { id: "groq/openai/gpt-oss-20b", name: "GPT-OSS 20B", provider: "groq", ctx: 131072 },
    { id: "ibm-granite/granite-4-10b-preview:free", name: "Granite 4 10B", provider: "openrouter", ctx: 131072, aliases: ["free"] },
    { id: "groq/whisper-large-v3-turbo", name: "Whisper Turbo", provider: "groq", ctx: 0, audio: true, aliases: ["transcribe"] },
    { id: "mistralai/mistral-small-3.2-24b-instruct:free", name: "Mistral Small 3.2", provider: "openrouter", ctx: 32768, aliases: ["free"] },
    { id: "qwen/qwen3-235b-a22b-instruct:free", name: "Qwen3 235B MoE", provider: "openrouter", ctx: 40960, aliases: ["free"] },
    { id: "nvidia/llama-3.1-nemotron-nano-12b-v2-vl:free", name: "Nemotron 12B VL", provider: "openrouter", ctx: 131072, aliases: ["free", "vision"] },
    { id: "google/gemma-4-26b-it:free", name: "Gemma 4 26B", provider: "openrouter", ctx: 131072, aliases: ["free"] },
    { id: "nvidia/llama-3.3-nemotron-super-49b-v1:free", name: "Nemotron Super 49B", provider: "openrouter", ctx: 131072, aliases: ["free", "smart"] },
    { id: "qwen/qwen3-30b-a3b-instruct:free", name: "Qwen3 30B MoE", provider: "openrouter", ctx: 40960, aliases: ["free"] },
  ],
  fallbackChain: [
    { provider: "groq", model: "groq/openai/gpt-oss-20b" },
    { provider: "openrouter", model: "google/gemma-4-31b-it:free" },
    { provider: "nvidia", model: "meta-llama/llama-3.2-90b-vision-instruct:free" },
    { provider: "openrouter", model: "qwen/qwen3-coder-480b-a35b-instruct:free" },
    { provider: "openrouter", model: "ibm-granite/granite-4-10b-preview:free" },
    { provider: "openrouter", model: "mistralai/mistral-small-3.2-24b-instruct:free" },
    { provider: "openrouter", model: "qwen/qwen3-235b-a22b-instruct:free" },
    { provider: "openrouter", model: "qwen/qwen3-30b-a3b-instruct:free" },
  ],
};

fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(config, null, 2));
console.log("NOIR cloud: config generated from env vars");

// Tell server.js to use this directory as root (not parent)
process.env.NOIR_ROOT = __dirname;
process.env.NOIR_CONFIG = path.join(__dirname, "config.json");
process.env.NOIR_WORKSPACE = path.join(__dirname, "workspace");

// Boot the actual server
require("./server.js");
