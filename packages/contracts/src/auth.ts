export type MeUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: string;
};

export type MeResponse = {
  user: MeUser;
};
