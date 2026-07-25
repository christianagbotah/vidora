import { NextResponse } from "next/server";

// Token packages available for purchase
const TOKEN_PACKAGES = [
  {
    id: "starter",
    name: "Starter",
    tokens: 10,
    priceGHS: 5,
    priceUSD: 1,
    popular: false,
    features: ["10 video downloads", "Basic support"],
  },
  {
    id: "basic",
    name: "Basic",
    tokens: 25,
    priceGHS: 10,
    priceUSD: 2,
    popular: true,
    features: ["25 video downloads", "Priority support", "AI Director Mode"],
  },
  {
    id: "pro",
    name: "Pro",
    tokens: 50,
    priceGHS: 18,
    priceUSD: 4,
    popular: false,
    features: ["50 video downloads", "Priority support", "AI Director Mode", "Continuity Checker"],
  },
  {
    id: "business",
    name: "Business",
    tokens: 100,
    priceGHS: 30,
    priceUSD: 6,
    popular: false,
    features: ["100 video downloads", "Priority support", "All AI features", "Custom branding"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tokens: 250,
    priceGHS: 65,
    priceUSD: 12,
    popular: false,
    features: ["250 video downloads", "Dedicated support", "All AI features", "Custom branding", "API access"],
  },
];

export async function GET() {
  return NextResponse.json({
    success: true,
    packages: TOKEN_PACKAGES,
  });
}
