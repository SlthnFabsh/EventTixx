export interface Artist {
  id: string;
  name: string;
  image_url: string | null;
  bio: string | null;
  created_at: string;
}

export interface Song {
  id: string;
  artist_id: string;
  title: string;
  duration: number | null;
  album: string | null;
  created_at: string;
}

export interface Event {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  venue: string;
  address: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  created_at: string;
}
