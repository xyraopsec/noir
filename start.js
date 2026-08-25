// NOIR cloud start — generates config.json from env vars, then boots server
const fs = require("fs");
const path = require("path");

const WORKSPACE = path.join(__dirname, "workspace");
fs.mkdirSync(WORKSPACE, { recursive: true });

const config = {
  port: parseInt(process.env.PORT || "3000"),
  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  titleModel: "groq|openai/gpt-oss-20b",
  providers: {
    openrouter: { base: "https://openrouter.ai/api/v1", key: process.env.OPENROUTER_API_KEY || "" },
    groq: { base: "https://api.groq.com/openai/v1", key: process.env.GROQ_API_KEY || "" },
    gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", key: process.env.GEMINI_API_KEY || "" },
    cerebras: { base: "https://api.cerebras.ai/v1", key: process.env.CEREBRAS_API_KEY || "" },
    nvidia: { base: "https://integrate.api.nvidia.com/v1", key: process.env.NVIDIA_API_KEY || "" },
    mistral: { base: "https://api.mistral.ai/v1", key: process.env.MISTRAL_API_KEY || "" },
  },
  fallbacks: [
    "gemini|gemini-3.7-flash",
    "openrouter|z-ai/glm-5.2:free",
    "groq|openai/gpt-oss-120b",
    "nvidia|meta/llama-3.3-70b-instruct",
    "groq|qwen/qwen3.6-27b",
    "cerebras|gpt-oss-120b",
    "gemini|gemini-3.5-flash",
    "nvidia|meta/llama-3.2-90b-vision-instruct",
    "groq|openai/gpt-oss-20b",
    "openrouter|nvidia/nemotron-3.5-lightning:free",
    "openrouter|google/gemma-4-31b-it:free",
    "gemini|gemini-2.5-flash-lite",
  ],
  models: {
    auto: { label: "Auto", sub: "picks the smartest per task", provider: "auto", id: "auto" },
    glm: { label: "GLM 5.2", sub: "openrouter · smart", provider: "openrouter", id: "z-ai/glm-5.2:free" },
    gem37: { label: "Gemini 3.7 Flash", sub: "google · smart + vision", provider: "gemini", id: "gemini-3.7-flash" },
    gem35: { label: "Gemini 3.5 Flash", sub: "google · fast + vision", provider: "gemini", id: "gemini-3.5-flash" },
    gem31pro: { label: "Gemini 3.1 Pro", sub: "google · deepest", provider: "gemini", id: "gemini-3.1-pro-preview" },
    groq120: { label: "GPT-OSS 120B", sub: "groq · rocket", provider: "groq", id: "openai/gpt-oss-120b" },
    groq20: { label: "GPT-OSS 20B", sub: "groq · instant", provider: "groq", id: "openai/gpt-oss-20b" },
    groqqwen: { label: "Qwen3.6 27B", sub: "groq · balanced", provider: "groq", id: "qwen/qwen3.6-27b" },
    compound: { label: "Compound Agent", sub: "groq · built-in tools", provider: "groq", id: "groq/compound" },
    nv70: { label: "Llama 3.3 70B", sub: "nvidia · solid", provider: "nvidia", id: "meta/llama-3.3-70b-instruct" },
    nvvision: { label: "Llama 90B Vision", sub: "nvidia · vision", provider: "nvidia", id: "meta/llama-3.2-90b-vision-instruct" },
    cb120: { label: "GPT-OSS 120B", sub: "cerebras · rocket", provider: "cerebras", id: "gpt-oss-120b" },
    cbgemma: { label: "Gemma 4 31B", sub: "cerebras · vision", provider: "cerebras", id: "gemma-4-31b" },
    vision: { label: "Gemma 4 31B", sub: "openrouter · vision", provider: "openrouter", id: "google/gemma-4-31b-it:free" },
    lightning: { label: "Nemotron Lightning", sub: "openrouter · instant", provider: "openrouter", id: "nvidia/nemotron-3.5-lightning:free" },
    ultra: { label: "Nemotron Ultra", sub: "openrouter · 550B", provider: "openrouter", id: "nvidia/nemotron-3-ultra-550b-a55b:free" },
  },
  codes: ["K9M-Q2X", "V4T-7RB", "D8H-3NW", "P6C-5YK"],
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    secret: process.env.GOOGLE_SECRET || "28bf9e219aa08b48557b047dcd66380fdd00f24dd325d696",
    allowed: [
      "andi.selmani@stud.sek-ds.ch",
      "david.salgado@stud.sek-ds.ch",
      "david.rosario@stud.sek-ds.ch",
      "lisian.ademi@stud.sek-ds.ch",
      "matteo.retortillo@stud.sek-ds.ch",
    ],
  },
};

fs.writeFileSync(path.join(__dirname, "config.json"), JSON.stringify(config, null, 2));
console.log("NOIR cloud: config generated from env vars");

process.env.NOIR_ROOT = __dirname;
process.env.NOIR_CONFIG = path.join(__dirname, "config.json");
process.env.NOIR_WORKSPACE = path.join(__dirname, "workspace");

require("./server.js");
