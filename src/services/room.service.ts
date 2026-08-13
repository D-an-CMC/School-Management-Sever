import { supabase } from '../config/supabase';
import { success, error } from '../utils/response';

export class RoomService {
  async list() {
    const result = await supabase.from('rooms').select('*').order('room_name');
    if (result.error) return error(result.error.message, 'DB_ERROR');
    return success(result.data ?? []);
  }

  async create(data: { room_name: string; room_type?: string }) {
    const { data: created, error: dbError } = await supabase
      .from('rooms')
      .insert({ room_name: data.room_name, room_type: data.room_type || null })
      .select('*')
      .single();
    if (dbError) return error(dbError.message, 'DB_ERROR');
    return success(created);
  }

  async update(id: number, data: { room_name?: string; room_type?: string | null }) {
    const updateData: any = {};
    if ('room_name' in data) updateData.room_name = data.room_name;
    if ('room_type' in data) updateData.room_type = data.room_type ?? null;
    const { data: updated, error: dbError } = await supabase
      .from('rooms')
      .update(updateData)
      .eq('room_id', id)
      .select('*')
      .single();
    if (dbError) return error(dbError.message, 'DB_ERROR');
    return success(updated);
  }

  async remove(id: number) {
    const { data, error: dbError } = await supabase.from('rooms').delete().eq('room_id', id).select('*').single();
    if (dbError) return error(dbError.message, 'DB_ERROR');
    return success(data);
  }

  // Rooms assignable to a class + the class's fixed room.
  async classRooms(classId: number) {
    const { data: links, error: linkErr } = await supabase
      .from('class_rooms')
      .select('room_id, rooms(*)')
      .eq('class_id', classId);
    if (linkErr) return error(linkErr.message, 'DB_ERROR');

    const { data: cls, error: clsErr } = await supabase
      .from('classes')
      .select('class_id, fixed_room_id, rooms:rooms!classes_fixed_room_id_fkey(*)')
      .eq('class_id', classId)
      .maybeSingle();
    if (clsErr) return error(clsErr.message, 'DB_ERROR');

    const rooms = (links ?? []).map((l: any) => l.rooms).filter(Boolean);
    const fixedRoom = (cls as any)?.rooms ?? null;
    return success({ rooms, fixed_room_id: (cls as any)?.fixed_room_id ?? null, fixedRoom });
  }

  // Replace the set of rooms assignable to a class.
  async saveClassRooms(classId: number, roomIds: number[]) {
    const ids = Array.from(new Set((roomIds || []).map((r) => Number(r)).filter(Boolean)));
    const del = await supabase.from('class_rooms').delete().eq('class_id', classId);
    if (del.error) return error(del.error.message, 'DB_ERROR');
    if (ids.length > 0) {
      const rows = ids.map((room_id) => ({ class_id: classId, room_id }));
      const ins = await supabase.from('class_rooms').insert(rows);
      if (ins.error) return error(ins.error.message, 'DB_ERROR');
    }
    return success(ids);
  }

  // Find the class that currently uses the room as its fixed room (excluding classId).
  async fixedRoomOwner(roomId: number, excludeClassId?: number) {
    let q = supabase
      .from('classes')
      .select('class_id, class_name, fixed_room_id, rooms:rooms!classes_fixed_room_id_fkey(room_id, room_name)')
      .eq('fixed_room_id', roomId);
    if (excludeClassId) q = q.neq('class_id', excludeClassId);
    const { data, error: dbError } = await q.maybeSingle();
    if (dbError) return null;
    return data || null;
  }
}

export const roomService = new RoomService();
