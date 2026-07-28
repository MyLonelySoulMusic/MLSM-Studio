import { parseProject, type RhythmBallProject } from "@rbs/project-schema";

export interface ProjectRepository {
  load(): Promise<string | null>;
  save(content: string): Promise<void>;
}

export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}

  async save(project: RhythmBallProject): Promise<RhythmBallProject> {
    const updated = parseProject({ ...project, project: { ...project.project, updatedAt: new Date().toISOString() } });
    await this.repository.save(JSON.stringify(updated, null, 2));
    return updated;
  }

  async load(): Promise<RhythmBallProject | null> {
    const content = await this.repository.load();
    if (content === null) return null;
    return parseProject(JSON.parse(content) as unknown);
  }
}

export class MemoryProjectRepository implements ProjectRepository {
  content: string | null = null;
  async load(): Promise<string | null> { return this.content; }
  async save(content: string): Promise<void> { this.content = content; }
}
