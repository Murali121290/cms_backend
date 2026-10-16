export function getUserDisplayName(user: { first_name?: string | null, last_name?: string | null, username?: string | null, user_name?: string | null } | null | undefined): string {
  if (!user) return "Unknown User";
  const firstName = (user.first_name || '').trim();
  const lastName = (user.last_name || '').trim();
  let fullName = '';
  if (firstName && lastName) {
    if (firstName.endsWith(` ${lastName}`) || firstName.endsWith(lastName)) {
      fullName = firstName;
    } else {
      fullName = `${firstName} ${lastName}`;
    }
  } else {
    fullName = firstName || lastName;
  }
  const fallback = user.username || user.user_name || "Unknown User";
  return fullName.length > 0 ? fullName : fallback;
}
