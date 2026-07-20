declare module '#auth-utils' {
  interface User {
    id: 'admin'
    email: string
    name: string | null
    role: 'admin'
  }

  interface UserSession {
    loggedInAt?: number
    passwordUpdatedAt?: number
  }
}

export {}
