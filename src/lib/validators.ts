/**
 * Shared Zod validation schemas for API routes.
 * Import and use: `const result = loginSchema.safeParse(body);`
 */
import { z } from "zod";

// ── Auth ──
export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[0-9]/, "Must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Must contain at least one special character"),
});

// ── Projects ──
export const createProjectSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).optional(),
  style: z.string().max(50).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "21:9"]).optional(),
  projectType: z.string().max(50).optional(),
});

// ── Scenes ──
export const createSceneSchema = z.object({
  prompt: z.string().min(1, "Prompt is required").max(5000),
  enhancedPrompt: z.string().max(5000).optional(),
  duration: z.number().min(1).max(30).optional(),
  transition: z.string().max(50).optional(),
});

// ── Export ──
export const exportVideoSchema = z.object({
  projectId: z.string().min(1),
  quality: z.enum(["draft", "standard", "high", "ultra"]).optional(),
  transition: z.string().max(50).optional(),
  format: z.enum(["mp4", "webm"]).optional(),
  withTitleCard: z.boolean().optional(),
});

// ── AI Generation ──
export const generateSceneSchema = z.object({
  sceneId: z.string().min(1),
  prompt: z.string().min(1).max(2000).optional(),
});

export const enhancePromptSchema = z.object({
  prompt: z.string().min(1, "Prompt is required").max(5000),
  style: z.string().max(50).optional(),
  aspectRatio: z.string().max(10).optional(),
});

// ── Payments ──
export const initializePaymentSchema = z.object({
  packageId: z.string().min(1),
  gateway: z.enum(["paystack", "hubtel", "stripe"]).optional(),
});
