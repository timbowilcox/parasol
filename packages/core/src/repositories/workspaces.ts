import { BaseRepository } from './base.js'
import type { Tables } from './types.js'
import { NotFoundError } from '../errors/index.js'

export type Workspace = Tables<'workspaces'>

export class WorkspaceRepository extends BaseRepository {
  async getById(id: string): Promise<Workspace> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    if (!data) throw new NotFoundError('Workspace', id)
    return data
  }

  async getBySlug(slug: string): Promise<Workspace> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('*')
      .eq('slug', slug)
      .maybeSingle()

    if (error) throw error
    if (!data) throw new NotFoundError('Workspace', slug)
    return data
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('*')
      .eq('slug', slug)
      .maybeSingle()

    if (error) throw error
    return data
  }
}
