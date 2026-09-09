# Privacy Policy (Draft — Not Published)

**Status: draft only.** This has not been reviewed by counsel, published to any URL, or linked
from the app. It is prepared here so the repo owner can review, edit, and decide where/whether
to host it before beta distribution — publishing or hosting it is a Stage B action requiring
explicit approval (see [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)). Placeholders are marked
`[TODO: ...]`.

---

## Privacy Policy for [TODO: final app name]

**Last updated:** [TODO: publish date]

### What data we collect

- **Account information**: your email address and the display name/avatar you choose.
- **Content you create**: tasks, events, and responsibilities you or your family create,
  including their titles, descriptions, dates, and completion status.
- **Family membership**: who is in your Family Space, their role (adult/child profile), and
  the invitations you send.
- **Device notification tokens**: an opaque identifier used to deliver push notifications to
  your device. This token is never shown to other users and never appears in a notification's
  own content.
- **Diagnostic identifiers**: internal row/operation identifiers used for troubleshooting.
  Task and event titles, descriptions, and notes are never included in diagnostic logs — see
  [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), "Mechanism 5," for the exact logging
  contract.

### What we do not collect

- No analytics, advertising, or third-party tracking SDK is present in this app, as of this
  writing — see [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), "Mechanism 6." If this
  changes in a future release, this policy will be updated first.
- No location data.
- No payment information (the app is free during the beta).

### How your data is shared within a Family Space

- A task or event you mark **Private** is visible only to you. Other family members may see
  that a time slot is occupied (a generic "Busy" block), but never its title, description, or
  any other detail.
- A task or event you mark **Family** is visible to every current member of that Family Space.
- A child profile has no account or login of its own; an adult family member manages it.

### How long we keep your data

- Content you delete (a task, an event) is retained in a recoverable, non-visible state for a
  period before permanent removal, consistent with this app's soft-delete convention — see
  [DATA_MODEL.md](DATA_MODEL.md).
- If you delete your account, your profile is anonymized (name and avatar cleared) rather than
  immediately erased, so that content you shared with your family remains intact for them.
  See "Deleting your account," below, for the full detail.
- If you delete a Family Space you own, every member loses access to it immediately; the
  underlying records are retained (not permanently erased) for a period, consistent with the
  soft-delete convention above.

### Deleting your account

You can request account deletion at any time from the app's Profile screen (a typed
confirmation is required to prevent accidental deletion). If you currently own a Family Space,
you must first transfer ownership to another adult member or delete the family — the app will
not let you delete an account that would leave a family without an owner.

When you delete your account:

- Your profile's display name and avatar are cleared and it is marked deleted.
- Your own private tasks and events are removed from view.
- Family-shared content you created remains visible to your former family members (deleting
  it would remove something they may still depend on — for example, a shared task assigned to
  someone else).
- Your device's notification token is deactivated.
- Any pending invitations you sent are canceled.
- You are signed out and your device clears all locally cached app data for your account.

[TODO: once the account-purge Edge Function described in
`docs/DECISIONS.md`, "Phase 10," is built and deployed, update this section to describe full
`auth.users` erasure and any associated timeline.]

### Your choices

- You can edit your display name, avatar, and language preference at any time.
- You can leave a Family Space at any time (if you are not its sole owner).
- You can request account deletion at any time, subject to the ownership-transfer rule above.

### Who can access your data

Only you and the members of any Family Space you belong to can access your data through the
app, subject to the Private/Family visibility rule above. [TODO: repo owner — describe who at
your organization can access the underlying database for support/incident response, and under
what circumstances, once an operator/support process exists.]

### Contact

[TODO: support email or contact form — required before beta distribution, see
`docs/BETA_TESTING.md`, "Support info."]

### Changes to this policy

[TODO: describe how testers/users will be notified of material changes once this policy is
actually published.]
