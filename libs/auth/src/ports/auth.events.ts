export interface UserRegisteredEvent {
  userId: string;

  email: string;
}

export interface UserLoggedInEvent {
  userId: string;

  at: Date;
}

export interface PasswordChangedEvent {
  userId: string;
}

export interface RefreshTokenReuseDetectedEvent {
  userId: string;

  familyId: string;
}
