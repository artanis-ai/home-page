# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a static landing page for Artanis AI (artanis.ai), deployed via GitHub Pages. The entire site is a single HTML file with no build process or dependencies.

**Product:** SaaS platform for measuring AI accuracy in production
**Value Proposition:** "Seamless labelling and evals with 3 lines of code"
**Target Audience:** Technical teams (AI engineers, ML engineers) at startups

## Deployment

Changes deploy automatically when pushed to the `main` branch via GitHub Pages. The CNAME file configures the custom domain (artanis.ai).

To deploy changes:
```bash
git add index.html img/
git commit -m "description of changes"
git push origin main
```

## Page Structure

The site has a simple, focused structure with 5 main sections:

1. **Header** - Sticky navigation with logo, Blog link, Contact Us button
2. **Hero** - "Measure AI accuracy in production" + "Seamless labelling and evals with 3 lines of code"
3. **Customer Marquee** - Scrolling showcase of 17 client companies (no label)
4. **Blog** - Substack RSS feed in 3-column responsive grid (6 most recent posts)
5. **Team** - 3 team members with full bios (Sam, Yousef, Olly)
6. **Contact** - CTA with email link
7. **Footer** - Links to Terms and Privacy

## Content Strategy

**Key Messaging (Technical Audience):**
- Headline: "Measure AI accuracy in production"
- Subheadline: "Seamless labelling and evals with 3 lines of code"
- Meta description: Same as above
- Contact: "Want to measure your AI's accuracy in production? Let's talk."

**Logo:**
- Local: `img/artanis.png` (downloaded from Squarespace)
- Height: h-10 (40px) in header
- **No text next to logo** - logo includes the wordmark

**Customer Marquee:**
- 17 companies total: Charterhouse, MoveGB, MindsDB, SalesAPE, Stylus, Telus, HG Capital, Evoke Medical Care, Sophos, Contextual AI, Medsnapp, Kliq, Sawa, From Today, Odyssey, FE Fundinfo, Jubel
- Duplicated list for seamless infinite scroll animation
- **No label** - just the marquee
- Update both sets when adding/removing clients

**Blog Feed:**
- Automatically fetched client-side via RSS2JSON API
- Substack blog: `https://artanis.substack.com/feed`
- Displays 6 most recent posts
- Responsive grid: 1 column (mobile), 2 columns (tablet), 3 columns (desktop)
- No manual updates needed for new posts

**Team Members (3 people):**
- Photos stored in `img/` directory (downloaded from Squarespace)
- Photos: sam.jpg, yousef.jpg, olly.jpg (not .png)
- Section heading: "Team" (not "Co-Founders")
- **No individual titles displayed** - just name and bio
- Each card includes:
  - Photo (w-40 h-40 rounded-full)
  - Name (Dr Sam Miller, Dr Yousef Amar, Dr Olly Styles)
  - Full bio paragraph with detailed background

**Team Bios:**
- **Sam Miller:** AI PhD from Alan Turing Institute. Founded VC-backed Atlas AI. Research used by Google & Nvidia.
- **Yousef Amar:** PhD Computer Science Imperial College. Founded Krew AI. Full-stack engineer. Two #1 Product Hunt products.
- **Olly Styles:** PhD Machine Learning Warwick. Co-founded Atlas AI. Senior ML Engineer at Multiverse (EdTech unicorn).

**CTA:**
- Primary CTA: "Contact us" (hero and footer)
- mailto: team@artanis.ai (opens in new tab)
- Subject/body pre-filled about measuring AI accuracy
- No pricing displayed on website

## Design System

**Technology Stack:**
- Tailwind CSS loaded via CDN (no local config)
- Custom theme config with primary blue (#2563eb)
- Max container width: 7xl (1280px)
- No JavaScript framework (vanilla JS for RSS feeds)

**Visual Style:**
- Professional, clean aesthetic for technical B2B audience
- Light theme: white/gray-50 backgrounds with gray-900 text
- Minimal borders using gray-100/gray-200
- Rounded elements (rounded-lg for cards, rounded-full for buttons)
- Subtle hover states with smooth transitions
- Shadow effects on blog cards

**Color Palette:**
- **Primary Blue**: #2563eb (pure blue, not purple)
- Background: white and gray-50 alternating sections
- Text: gray-900 (primary), gray-700 (secondary), gray-600 (tertiary)
- Borders: gray-100 (lighter), gray-200 (cards)
- Buttons: primary (#2563eb) background, white text
- Client logos: gray-400

**Typography:**
- Single font family: Inter (weights 400, 500, 600, 700)
- H1: text-5xl/text-6xl font-bold (hero)
- H2: text-3xl font-bold (all section headings - consistent across site)
- Body: text-xl/text-lg with gray-600/gray-700
- All headings use gray-900

**Section Headings (Consistent):**
All section headings use `<h2 class="text-3xl font-bold text-gray-900">`:
- Blog
- Team
- Get in Touch

**Layout:**
- Standard padding: px-6 for sections
- Section vertical padding: py-24 (standard), py-32 (contact)
- Hero: py-24 with gradient background
- Max width: max-w-7xl (header/footer), max-w-4xl (hero), max-w-6xl (content sections)

## Interactive Elements

**Marquee Animation:**
- CSS keyframe animation scrolling at 40s
- Pauses on hover
- Requires content duplication for seamless loop
- No label - clean presentation

**RSS Feed:**
- Fetches Substack via RSS2JSON API
- Renders in responsive grid (1/2/3 columns)
- Shows thumbnail (if available), title, description snippet, and date
- Relative date formatting (e.g., "3 days ago")
- Cards with hover effects (border color change, shadow)

## External Dependencies

- Tailwind CSS: `https://cdn.tailwindcss.com`
- Google Fonts: Inter (400, 500, 600, 700)
- RSS2JSON API: Converts RSS feeds to JSON for client-side rendering
- No npm packages or build tools required

## Images

All images are stored locally in `img/` directory:
- Logo: `img/artanis.png` (11KB WebP)
- Team photos: `img/sam.jpg`, `img/yousef.jpg`, `img/olly.jpg`
- Do not hotlink to external CDNs

## Removed Elements

The following sections were removed to keep the site simple and focused:
- "The Problem" section (4 pain points grid)
- "Our Solution" section (detailed explanation)
- "How It Works" section
- "Who We Built This For" section
- Individual role titles for team members (CEO, CTO, AI Engineer)
- "Customers" label on marquee
- "Artanis" text next to logo in header
