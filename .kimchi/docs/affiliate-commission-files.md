# Affiliate Commission Files Summary

This document summarizes all files in the RobinOS codebase that reference affiliate commission values, specifically mentioning "50%" or "50" in the context of affiliate commissions.

## Files Found

### 1. `/Users/ashad/Documents/RobinOS-main/src/pages/AffiliatePage.tsx`
- **Type**: Page/component
- **References**:
  - Line 231: `whileHover={{ x: 4, borderColor: "hsl(212 100% 50% / 0.3)" }}` - This appears to be a hover effect using 50% opacity, not directly related to affiliate commission values
  - Contains affiliate program information but no specific "50%" commission mentions

### 2. `/Users/ashad/Documents/RobinOS-main/src/pages/public/JVZooAffiliatePage.tsx`
- **Type**: Page/component
- **References**:
  - Line 60: `style={{ background: "radial-gradient(ellipse 60% 50% at 50% 50%, hsl(217 91% 60% / 0.06), transparent)" }}` - Visual effect using 50%
  - Line 63: `style={{ background: "linear-gradient(105deg, transparent 40%, hsl(217 91% 60% / 0.05) 50%, transparent 60%)" }}` - Visual gradient using 50%
  - Line 159: `style={{ background: "radial-gradient(ellipse 70% 40% at 50% 0%, hsl(142 70% 55% / 0.04), transparent)" }}` - Visual effect using 50%
  - Line 326: `<span className="text-chrome">Earn 50%</span><br />` - **Direct affiliate commission reference**: Prominent display of 50% commission offer
  - Line 411: `<p className="text-3xl font-bold font-mono" style={{ color: "hsl(142 70% 55%)" }}>50%</p>` - **Direct affiliate commission reference**: Large display of 50% commission rate
  - Line 438: `{ icon: DollarSign, title: "50% Recurring Commission", description: "Earn half of every subscription — every single month. No caps, no cutoffs.", highlight: "50% Lifetime", delay: 0 }` - **Direct affiliate commission reference**: Benefit card highlighting 50% recurring commission
  - Line 453: `<p className="text-muted-foreground max-w-lg mx-auto text-sm mt-3">50% recurring on every active subscription. Every month. Forever.</p>` - **Direct affiliate commission reference**: Description of commission structure
  - Line 490: `style={{ background: `radial-gradient(ellipse 80% 60% at 50% 100%, hsl(142 70% 55% / ${0.03 + i * 0.015}), transparent)` }}` - Visual effect using percentage calculation
  - Line 705: `{ q: "Is commission truly recurring?",    a: "Yes. You earn 50% of every monthly subscription payment as long as the customer stays active. No time limits.", delay: 0.04 }` - **Direct affiliate commission reference**: FAQ confirming 50% recurring commission
  - Line 721: `style={{ background: "radial-gradient(ellipse 70% 50% at 50% 0%, hsl(142 70% 55% / 0.06), transparent)" }}` - Visual effect using 50%
  - Line 728: `Join the RobinOS affiliate program today. 50% recurring commission on every active referral.` - **Direct affiliate commission reference**: Final CTA with commission mention
  - Line 733: `{["50% recurring","Global affiliates","Monthly payouts","Creator economy niche"].map((item) => (` - **Direct affiliate commission reference**: Trust badge mentioning "50% recurring"

### 3. `/Users/ashad/Documents/RobinOS-main/src/components/seo/PageSeo.tsx`
- **Type**: Component (SEO metadata)
- **References**:
  - Line 103: `description: "Become a RobinOS launch partner. Earn 50% recurring commission promoting the AI content operating system for creators."` - **Direct affiliate commission reference**: SEO description for launch partners page mentioning 50% commission

### 4. `/Users/ashad/Documents/RobinOS-main/supabase/migrations/10_affiliate_commission_lifecycle.sql`
- **Type**: Database migration/config file
- **References**: 
  - This file contains the complete affiliate commission lifecycle system but does not specifically mention "50%" values. It defines the commission structure and workflow where percentage-based commissions would be applied, but the specific percentage rate (like 50%) would likely be stored in the platform_settings table rather than hardcoded in the migration.

## Summary of Commission Types

Based on the files examined, the RobinOS affiliate program offers:

1. **50% Recurring Commission**: Specifically promoted in the JVZoo affiliate program
   - Applies to all subscription plans (Creator: $19/mo → $9.50/mo commission, Pro Creator: $39/mo → $19.50/mo commission, Agency: $99/mo → $49.50/mo commission)
   - Described as "lifetime" recurring commission for as long as referred customers remain active
   - Highlighted prominently in marketing materials and SEO descriptions

2. **General Affiliate Program**: The standard RobinOS affiliate program (AffiliatePage.tsx) 
   - References exist but specific commission percentages are not detailed in the examined files
   - Appears to follow a policy-based commission structure

## File Type Classification

- **Pages/Components**: 
  - `/src/pages/AffiliatePage.tsx` - Main affiliate program page
  - `/src/pages/public/JVZooAffiliatePage.tsx` - JVZoo-specific affiliate program page with prominent 50% commission offers
  - `/src/components/seo/PageSeo.tsx` - SEO component containing commission-related metadata

- **Config/Migration Files**:
  - `/supabase/migrations/10_affiliate_commission_lifecycle.sql` - Database schema for commission lifecycle (percentage rates would be configured elsewhere)

The JVZooAffiliatePage.tsx file contains the most explicit and prominent references to the 50% affiliate commission structure, presenting it as a key selling point of the affiliate program.
