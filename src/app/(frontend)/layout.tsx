import React from 'react'

export const metadata = {
  title: 'Event Registration',
  description: 'Admin for conference events, sessions, attendees and registrations.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
