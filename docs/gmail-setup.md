# Creating your Gmail app (a full walkthrough)

InboxMinder talks to Gmail as **your own** Google Cloud OAuth app. There is
no shared InboxMinder client, and that's deliberate: a shared client would
be a middleman with access to your mail, and Gmail's scopes sit in Google's
"restricted" category, where a shared app would need annual third-party
security audits and would cap how many users could connect.

So you create the app once, in your own Google account. It takes about five
minutes, you never write any code, and nothing about it costs money. This
page walks through every click.

**What you'll end up with:** a Client ID and a Client Secret, two strings
you paste into `inboxminder init` (or `inboxminder set-key`).

## Before you start

- You need a Google account with Gmail: either a **Google Workspace**
  account (mail on your own domain, e.g. `you@yourcompany.com`) or a
  **personal @gmail.com** account.
- Which one you have changes exactly one step (step 4, the consent screen),
  and it's worth knowing now:
  - **Workspace**: the best case. You'll mark the app "Internal", there is
    no warning screen, and your login never expires.
  - **Personal @gmail.com**: fully supported, with one caveat about token
    expiry that step 4 explains (and shows you how to avoid).

## Step 1: Create a project

1. Open [console.cloud.google.com](https://console.cloud.google.com) and
   sign in with the Google account whose mailbox you want minded.
2. At the top of the page, click the **project picker** (the dropdown next
   to the Google Cloud logo; it may say "Select a project").
3. Click **New project**.
4. Name it anything you like: `inboxminder` works. Leave organization and
   location as they are.
5. Click **Create**, wait a few seconds, then make sure the new project is
   **selected** in the picker (the console sometimes stays on your old
   project; everything below must happen inside this one).

## Step 2: Enable the Gmail API

1. In the left navigation (or the search bar at the top), go to
   **APIs & Services → Library**.
2. Search for **Gmail API**.
3. Click it, then click **Enable**.

That's the only API InboxMinder needs.

## Step 3: Set up the consent screen

The consent screen is the page Google shows you (and only you) when you
authorize the app in your browser.

> Google has been renaming this area of the console. Depending on when you
> read this, it's either **APIs & Services → OAuth consent screen** or a
> section called **Google Auth Platform** (with Branding / Audience /
> Clients pages). The settings are the same; only the navigation labels
> differ.

1. Go to **APIs & Services → OAuth consent screen** (click **Get started**
   if the console prompts you to configure it first).
2. **App name**: `InboxMinder` (this is just what the consent page shows
   you; call it anything).
3. **User support email**: pick your own address.
4. **Audience / User type**: this is the fork in the road.
   - **Google Workspace account**: choose **Internal**. Done: no test
     users, no verification warnings, and refresh tokens that never
     expire. If you have the choice, this is the setup to want.
   - **Personal @gmail.com**: **Internal** will be greyed out; choose
     **External**.
5. **Contact email**: your address again.
6. Agree to the user data policy checkbox and click **Create** / **Finish**.

### External only: add yourself as a test user

1. Still in the consent screen area, find **Test users** (on newer
   consoles this lives under **Audience**).
2. Click **Add users** and enter your own Gmail address.
3. Save.

An External app starts in **Testing** status, which is fine, but comes
with one real annoyance:

> **The 7-day token expiry (External + Testing only).** While an External
> app is in Testing status, Google expires its refresh tokens after 7
> days. In practice: about once a week, InboxMinder loses access, sends
> you a "Gmail authorization expired" notification, and you run
> `inboxminder auth` to re-authorize (30 seconds in the browser).
>
> **To make it permanent:** on the consent screen page, click **Publish
> app** to move it to **Production** status. You do NOT need to submit it
> for Google's verification review; just publish and ignore the "needs
> verification" notices. From then on, when you authorize you'll see a
> "Google hasn't verified this app" warning once; click **Advanced →
> Go to inboxminder (unsafe)**. That warning is Google talking about your
> own app, in your own account, whose code you can read. After that,
> tokens no longer expire on a timer.

## Step 4: Create the OAuth client

This is what produces the two strings you actually need.

1. Go to **APIs & Services → Credentials** (or **Clients** in the newer
   console).
2. Click **Create credentials → OAuth client ID**.
3. **Application type**: choose **Desktop app**. (Not "Web application".
   Desktop app is what allows the localhost redirect InboxMinder uses; no
   redirect URIs to configure.)
4. Name it anything (`inboxminder` again is fine) and click **Create**.
5. A dialog shows your **Client ID** (ends in
   `.apps.googleusercontent.com`) and **Client secret** (starts with
   `GOCSPX-`). Copy both, or download the JSON; you can also come back and
   view them any time from the Credentials page.

A note on the word "secret": for Desktop apps, Google itself documents
that the client secret is not treated as confidential in the way a server
secret is. InboxMinder still stores both values in your macOS Keychain,
never in config files.

## Step 5: Give the values to InboxMinder

If you're running `inboxminder init`, it asks for both values at the
right moment; paste them in and you're done. Otherwise, store them any
time:

```bash
inboxminder set-key gmail-client-id
inboxminder set-key gmail-client-secret
```

Each command prompts for the value and writes it to the macOS Keychain.

Then authorize:

```bash
inboxminder auth
```

Your browser opens Google's consent page. Sign in with the same account,
accept (clicking through the unverified-app warning if you published an
External app), and the browser tab will say authorization is complete.
Tokens land in the Keychain; InboxMinder's local web server for the
redirect only ever listens on localhost, only during this flow.

The requested scope is `gmail.modify`: read mail, write labels. There is
no send scope and no delete capability in what you just granted.

## Verify it works

```bash
inboxminder agent status
```

should report the agent running (install it with `inboxminder up` if you
haven't yet). Or preview a single classification without touching
anything:

```bash
inboxminder classify <gmail-message-id>
```

## Troubleshooting

**"Access blocked: inboxminder has not completed the Google verification
process"** during authorization. Your app is External and your address
isn't in Test users (step 3), or you're signing into a different Google
account than the one you added. Add the exact address and retry.

**"Google hasn't verified this app" warning.** Expected for an External
app published to Production. Click **Advanced**, then **Go to
inboxminder (unsafe)**. It's your own app; "unverified" means you didn't
submit it for Google's review, not that anything is wrong.

**Gmail authorization expired after about a week.** The External +
Testing token expiry described in step 3. Either re-run
`inboxminder auth` weekly, or publish the app to Production to stop the
timer.

**`Error 403: access_denied` or the consent page never lists Gmail
access.** The Gmail API isn't enabled in the same project as your OAuth
client (step 2), or the project picker was on the wrong project when you
created one of the two. Both must live in the same project.

**`invalid_client` when authorizing.** The Client ID or secret was pasted
with a stray space or line break, or one value went into the other's
prompt. Re-run both `set-key` commands and paste carefully.

**The browser flow completes but InboxMinder says auth failed.** Another
process may be holding the local callback port, or the flow sat open too
long. Just run `inboxminder auth` again; the flow is safe to repeat.

**Workspace account: "Internal" is greyed out.** You're signed into a
personal @gmail.com account, or your Workspace admin has restricted
project creation. Check the account in the console's top-right corner
first.

## FAQ

**Is this really free?** Yes. The Gmail API has no charge for this kind
of use, and nothing in this setup requires billing to be enabled on the
project.

**Can I revoke access later?** Any time: at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions)
(kills the tokens immediately), or by deleting the OAuth client or the
whole project in the console.

**Can I use one app for two mailboxes?** Yes. The OAuth client is just a
door; each InboxMinder profile (`--profile work`) stores its own tokens
for whichever account authorizes. For a Workspace Internal app, both
accounts must be on the same domain; otherwise make the app External and
add both addresses as test users.

**Why "Desktop app" and not "Web application"?** Desktop clients get the
loopback (localhost) redirect flow, which is exactly how a CLI on your
own machine should authorize. A Web client would demand redirect URIs
and a hosted callback, which InboxMinder doesn't have, by design.
