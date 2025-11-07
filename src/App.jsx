import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import VideoUpload from "./components/VideoUpload";
import { Toaster, toast } from "react-hot-toast";
import "./App.css";

function App() {
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState(null);

  useEffect(() => {
    fetchSurveys();
    getAccessToken();
  }, []);

  const getAccessToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setAccessToken(session?.access_token);
  };

  const fetchSurveys = async () => {
    try {
      const { data, error } = await supabase
        .from("surveys")
        .select(
          `
          *,
          videos (*)
        `
        )
        .order("timestamp", { ascending: false });

      if (error) throw error;
      setSurveys(data);
    } catch (error) {
      console.error("Error fetching surveys:", error);
      toast.error("Failed to load surveys");
    } finally {
      setLoading(false);
    }
  };

  const handleUploadComplete = async (surveyId, fileName, uploadId) => {
    const toastId = toast.loading("Processing upload...");
    try {
      const publicUrl = `https://cdn.bharatnet.survey.rio.software/uploads/${uploadId}`;
      const { data: videoData, error: videoError } = await supabase
        .from("videos")
        .insert({
          name: fileName,
          url: `https://cdn.bharatnet.survey.rio.software/uploads/${uploadId}`,
          survey_id: surveyId,
        })
        .select()
        .single();

      if (videoError) {
        console.error("Error creating video record:", videoError);
      }

      const { error: surveyError } = await supabase
        .from("surveys")
        .update({
          video_id: videoData.id,
          is_video_uploaded: true,
        })
        .eq("id", surveyId);

      if (surveyError) {
        console.error("Error updating survey:", surveyError);
      }

      setSurveys((prevSurveys) =>
        prevSurveys.map((survey) =>
          survey.id === surveyId
            ? {
                ...survey,
                video_id: videoData.id,
                is_video_uploaded: true,
                videos: [{ id: videoData.id, name: fileName, url: publicUrl }],
              }
            : survey
        )
      );

      toast.success("Video uploaded successfully!", { id: toastId });
    } catch (error) {
      console.error("Error processing upload:", error);
      toast.error("Failed to process upload", { id: toastId });
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="container">
      <Toaster position="top-center" />
      <h1>Survey Videos Management</h1>
      <div className="surveys-table">
        <table>
          <thead>
            <tr>
              <th>Survey Name</th>
              <th>Timestamp</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {surveys.map((survey) => (
              <tr key={survey.id} className="survey-row">
                <td>{survey.name}</td>
                <td>{new Date(survey.timestamp).toLocaleString()}</td>
                <td>
                  <span
                    className={`status-badge ${
                      survey.video_id == null ? "pending" : "uploaded"
                    }`}
                  >
                    {survey.video_id == null
                      ? "Pending Upload"
                      : "Video Uploaded"}
                  </span>
                </td>
                <td>
                  {survey.video_id == null && (
                    <VideoUpload
                      surveyId={survey.id}
                      onUploadComplete={handleUploadComplete}
                      accessToken={accessToken}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
