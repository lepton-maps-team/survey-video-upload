import { create } from 'zustand'

const initialState = {
  queue: [],
};

export const useQueueStore = create((set, get) => ({
  queue: [],
  addToQueue: (surveyId) => set((state) => ({ queue: [...state.queue, surveyId] })),
  removeFromQueue: (surveyId) => set((state) => ({ queue: state.queue.filter((id) => id !== surveyId) })),
  getQueue: () => get().queue,
  isUploading: (surveyId) => get().queue.includes(surveyId),
}));
