export type Env = CloudflareBindings & {
  PROJECT_REPOSITORY_URL?: string;
};

export type AppEnv = {
  Bindings: Env;
};
