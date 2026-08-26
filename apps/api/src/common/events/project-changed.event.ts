export const PROJECT_CHANGED_EVENT = 'project.changed';

export interface ProjectChangedEvent {
  projectId: string;
  action: string;
}
