# Security Specification — ScaleReach Multi-User Workspace

## 1. Data Invariants
1. **Strict User Ownership & PII Isolation**: `/users/{userId}` (containing `email`, `displayName`, `photoURL`) and all user subcollections (`projects`, `brandTemplates`, `scheduledPosts`, `usageHistory`) can only be read or written by the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`) or the bootstrapped admin.
2. **Parent Existence & Identity Integrity**: Subcollection documents must verify `ownerId == request.auth.uid`, valid alphanumeric/hyphen/underscore document IDs (`^[a-zA-Z0-9_\-]+$`, max 128 chars), and parent `/users/{userId}` existence on creation.
3. **Temporal & Field Immutability**: `createdAt` must equal `request.time` on creation and remain immutable; `updatedAt` must equal `request.time` on updates; `ownerId` and `id` cannot be mutated.
4. **Terminal State Locking**: Once a `ScheduledPost` reaches `status == "Published"`, non-admin users cannot revert or overwrite its fields.
5. **Payload Bounding**: All strings, enums, numbers, and arrays (`clips <= 15`) have strict length and type guards to prevent storage/document bloat.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Reading `/users/userA/projects/proj1` with `request.auth == null`.
2. **Unverified Email Write**: Creating a project when `request.auth.token.email_verified == false`.
3. **Cross-User PII Read**: User B reading `/users/userA` (email/profile leak).
4. **Identity Spoofing on Create**: User B creating `/users/userB/projects/p1` with `ownerId: "userA"`.
5. **Shadow / Ghost Field Injection**: Creating `/users/userA/projects/p1` with extra field `isAdmin: true`.
6. **ID Poisoning**: Creating `/users/userA/projects/../../etc/passwd` or a 200-char ID.
7. **Timestamp Forgery**: Creating `/users/userA/brandTemplates/bt1` with client-supplied `createdAt: "2020-01-01T00:00:00Z"`.
8. **Immutable Owner Tampering**: Updating `ownerId` on an existing `/users/userA/projects/p1`.
9. **Terminal State Reversal**: User A changing a `ScheduledPost` with `status == "Published"` back to `status: "Scheduled"`.
10. **Array Overflow**: Creating a `VideoProject` with 25 items in `clips` (exceeding max 15).
11. **Oversized String Exhaustion**: Setting `captionText` on a `ScheduledPost` to 5,000 characters (exceeding max 2,200).
12. **Usage Ledger Tampering**: Updating or deleting an immutable `UsageEntry` document as a non-admin user.
