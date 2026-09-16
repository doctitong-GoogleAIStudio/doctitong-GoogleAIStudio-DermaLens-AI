- **Effective date:** 16 September 2026
- **App:** DermaLens AI (Android, distributed on Google Play)
- **Developer / data controller:** aivicventures
- **Contact:** {{SUPPORT_EMAIL}}

DermaLens AI ("the app", "we", "us") lets you photograph a skin lesion and receive a preliminary, AI-generated analysis. This policy explains what information the app handles, where it is kept, for how long, how to delete it, and how subscriptions are managed.

> **DermaLens AI is not a medical device and does not provide medical advice, diagnosis or treatment.** Always consult a qualified health professional.

## 1. Information we collect

| Category | What it is | Where it is stored |
|---|---|---|
| **Account details** | Full name, email address, and a one-way hash of your password (bcrypt). | Our server (database). A copy of the account record, protected with a separate one-way hash (PBKDF2), is also kept on your phone so you can sign in offline. |
| **Skin photos, scan history, notes, PDF reports** | Photos you take or upload, the AI results, clinical history you type (body location, duration, symptoms, evolution, medical history, notes) and any notes or reports you create. | **Only on your phone.** They are never stored on our server. |
| **AI analysis transmission** | When you run an analysis, the photo(s) and any clinical history you entered are sent over an encrypted connection (HTTPS) to our server, which forwards them to Google's Gemini API to produce the result. | Processed transiently. Our server does not save the photos, the clinical history or the AI result. |
| **Analysis usage records** | For each analysis request: your account ID, number of images, response time, result status, the AI model name and a timestamp. No image and no result content. | Our server. Used for rate limiting, abuse prevention and service monitoring. |
| **Subscription data** | Google Play processes all payments. We receive the subscription product ID, purchase state and, if server-side verification is enabled, a Google purchase token used to confirm the subscription with Google. **We never receive your card or bank details.** | Google Play (payment data) and, where applicable, a verification record on our server. |
| **Device activation records (legacy)** | Earlier versions of the app used a hardware-derived Device ID for activation. If you used that, the Device ID together with the name and email you activated with may be on our server. | Our server. |
| **Backups you create** | The app can export your scans into an encrypted file sealed with a password you choose. | Wherever you choose to save it. We cannot open it and never receive it. |
| **Session tokens** | A sign-in token is stored in your phone's secure storage so you stay signed in. | Your phone. |

We do not use advertising SDKs, analytics trackers or third-party crash reporters, and we do not sell personal information.

## 2. How we use information

- To create and secure your account and let you sign in on your phone.
- To run the AI analysis you request and return the result to your phone.
- To enforce fair-use limits (for example a maximum number of analyses per hour) and to prevent fraud and abuse.
- To confirm your subscription entitlement with Google Play.
- To respond to support and account-deletion requests.
- To comply with legal obligations.

## 3. Third parties that process data

- **Google LLC – Gemini API.** Photos and clinical history are sent to Google to generate the analysis. Google's handling of API data is described in its [Gemini API terms](https://ai.google.dev/gemini-api/terms).
- **Google LLC – Google Play Billing.** Handles all subscription purchases, renewals, refunds and cancellations under the [Google Play Terms of Service](https://play.google.com/about/play-terms/) and [Google Privacy Policy](https://policies.google.com/privacy).
- **Hosting / database provider** for our server, bound by data-processing terms.
- **Transactional email provider**, used only to notify our support team of activation or deletion requests.

## 4. Retention

| Data | Retention |
|---|---|
| Account details | For as long as your account exists. Deleted when you delete your account. |
| Photos, scan history, notes, reports | Kept on your phone until you delete a scan, delete your account in the app, or uninstall the app. |
| Photos and clinical history sent for analysis | Not retained by our server after the response is returned. |
| Analysis usage records | Retained while your account exists for rate-limiting and abuse prevention; **de-identified** (your account ID removed) when you delete your account. De-identified counts may be kept for service statistics. |
| Subscription verification records | Deleted when you delete your account. Google Play keeps its own transaction records under Google's policies. |
| Legacy device-activation records | Activation requests are deleted with your account; the device activation itself is kept but **de-identified** (your name and email removed) so a paid activation continues to work on that device. |
| Deletion record | A one-way hash (SHA-256) of the deleted account's email address plus the deletion date, kept for up to **24 months** for security, fraud-prevention, billing-dispute and legal purposes. It cannot be used to contact you. |
| Server backups | Encrypted database backups are rotated within **30 days**, after which deleted data no longer exists in any backup. |

## 5. Deleting your account and data

You can delete your account in two ways:

1. **In the app:** Settings (About tab) → **Account & Subscription** → **Delete My Account and Data**. You will be asked to re-enter your password and confirm. The app then deletes your account on our server, de-identifies server records as described above, deletes your scans and photos from the phone, removes sign-in tokens and signs you out.
2. **Without the app:** open our account-deletion page at `{{DELETION_URL}}`, enter your email and password, and confirm. If you cannot sign in, the same page lets you submit a deletion request; we verify ownership of the email address and complete the deletion within 30 days.

Deletion is permanent. What is retained afterwards is limited to the items listed in section 4 ("Deletion record", de-identified records) and anything we are legally required to keep.

**Deleting your account does not cancel a Google Play subscription** (see section 6).

## 6. Subscriptions and cancellation

DermaLens AI Premium is a paid subscription sold through Google Play Billing. Google Play is the source of truth for whether a subscription is active, in a free trial, cancelled-but-still-active, in a billing grace period, on account hold, paused, expired or restored.

- **To cancel:** open Google Play → *Payments & subscriptions* → *Subscriptions* → DermaLens AI → *Cancel subscription*, or use **Manage Google Play Subscription** inside the app, which opens the same page.
- Cancelling stops future renewals. It does not normally remove access until the end of the current paid or trial period.
- Refunds are handled by Google Play under Google's refund policy.
- **Deleting your DermaLens AI account does not cancel the subscription.** If you delete your account while a subscription is active, Google Play will continue to bill you until you cancel it in Google Play.

## 7. Security

Data in transit is protected with HTTPS. Passwords are stored only as salted one-way hashes. Sign-in tokens are kept in your phone's secure storage (Android Keystore-backed EncryptedSharedPreferences). Our server never forwards raw error details from Google that could expose credentials. No system is perfectly secure; contact us if you believe your account has been compromised.

## 8. Your rights

Depending on where you live you may have the right to access, correct, export, restrict or delete your personal information, or to object to certain processing. You can delete your account yourself as described in section 5. For any other request contact {{SUPPORT_EMAIL}}. You may also lodge a complaint with your local data-protection authority.

## 9. Children

DermaLens AI is not directed at children under 13 (or the higher minimum age in your country) and we do not knowingly collect personal information from them. If you believe a child has created an account, contact us and we will delete it.

## 10. International transfers

Our server and Google's services may be located outside your country. By using the app you understand that your information may be processed in those locations, subject to appropriate safeguards.

## 11. Changes to this policy

We will post any changes on this page and update the effective date. Material changes will also be announced in the app.

## 12. Contact

- **Developer:** aivicventures
- **Email:** {{SUPPORT_EMAIL}}
- **Account deletion page:** `{{DELETION_URL}}`
