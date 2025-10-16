import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import VideoUpload from "../components/VideoUpload";
import { Toaster, toast } from "react-hot-toast";
import { useAuth } from "../contexts/AuthContext";

function Home() {
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { user, isAdmin, isManager } = useAuth();

  // Debounce utility function
  const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  // Helper function to format duration
  const formatDuration = (minutes) => {
    if (!minutes || minutes === 0) return "N/A";

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours === 0) {
      return `${remainingMinutes}m`;
    } else if (remainingMinutes === 0) {
      return `${hours}h`;
    } else {
      return `${hours}h ${remainingMinutes}m`;
    }
  };

  useEffect(() => {
    if (user) {
      fetchSurveys();
      getAccessToken();
    }
  }, [user]);

  // Debounced search function
  const debouncedSearch = useCallback(
    debounce((searchValue) => {
      fetchSurveys(searchValue);
    }, 300),
    [user, isAdmin, isManager]
  );

  useEffect(() => {
    if (user) {
      debouncedSearch(searchTerm);
    }
  }, [searchTerm, debouncedSearch, user]);

  const getAccessToken = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setAccessToken(session?.access_token);
  };

  const fetchSurveys = async (searchValue = "") => {
    if (!user) return;

    try {
      if (searchValue.trim()) {
        setSearchLoading(true);
      } else {
        setLoading(true);
      }

      // Build the base query
      let query = supabase.from("surveys").select(`
          *,
          videos (*),
          gps_tracks (id, name, duration)
        `);

      // Add search filter if search term is provided
      if (searchValue.trim()) {
        query = query.ilike("name", `%${searchValue}%`);
      }

      if (isAdmin) {
        // Admin sees all surveys
        const { data, error } = await query
          .order("timestamp", { descending: true })
          .limit(100);

        if (error) throw error;
        setSurveys(data);
      } else if (isManager) {
        // Managers see their own surveys
        const { data: ownSurveys, error: ownError } = await query
          .eq("user_id", user.id)
          .order("timestamp", { descending: true })
          .limit(100);

        if (ownError) throw ownError;

        // And surveys from their surveyors
        const { data: surveyorIds, error: surveyorError } = await supabase
          .from("users")
          .select("user_id")
          .eq("manager_id", user.id);

        if (surveyorError) throw surveyorError;

        // If has surveyors, get their surveys too
        let surveyorSurveys = [];
        if (surveyorIds && surveyorIds.length > 0) {
          const surveyorIdList = surveyorIds.map((s) => s.user_id);
          let teamQuery = supabase
            .from("surveys")
            .select(
              `
              *,
              videos (*),
              gps_tracks (id, name, duration)
            `
            )
            .in("user_id", surveyorIdList);

          // Add search filter for team surveys too
          if (searchValue.trim()) {
            teamQuery = teamQuery.ilike("name", `%${searchValue}%`);
          }

          const { data: teamSurveys, error: teamError } = await teamQuery
            .order("timestamp", { descending: true })
            .limit(100);

          if (teamError) throw teamError;
          surveyorSurveys = teamSurveys;
        }

        // Combine both sets of surveys
        setSurveys([...ownSurveys, ...surveyorSurveys]);
      } else {
        // Surveyors only see their own surveys
        const { data, error } = await query
          .eq("user_id", user.id)
          .order("timestamp", { descending: true });

        if (error) throw error;
        setSurveys(data);
      }
    } catch (error) {
      console.error("Error fetching surveys:", error);
      toast.error("Failed to load surveys");
    } finally {
      setLoading(false);
      setSearchLoading(false);
    }
  };

  const handleUploadComplete = async (surveyId, fileName, uploadId) => {
    const toastId = toast.loading("Processing upload...");
    try {
      // Get public URL
      const publicUrl = `https://ankithfdnverma.s3.cyfuture.cloud/bharatnet/${uploadId}`;
      // Create video record and update survey in a transaction
      const { data: videoData, error: videoError } = await supabase
        .from("videos")
        .insert({
          name: fileName,
          url: publicUrl,
          survey_id: surveyId,
        })
        .select()
        .single();

      if (videoError) throw videoError;

      // Update survey with video_id and is_video_uploaded
      const { error: surveyError } = await supabase
        .from("surveys")
        .update({
          video_id: videoData.id,
          is_video_uploaded: true,
        })
        .eq("id", surveyId);

      if (surveyError) throw surveyError;

      console.log("updating survey", surveyId);

      // Update only the specific survey in the state instead of refreshing all
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
      <div className="page-header">
        <h1>Survey Videos Management</h1>
        <div className="header-description">
          <p>View and manage your survey video uploads</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="search-section">
        <div className="search-input-wrapper">
          <input
            type="text"
            placeholder="Search surveys by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          {searchLoading && <div className="search-loading">Searching...</div>}
          {searchTerm && !searchLoading && (
            <button
              onClick={() => setSearchTerm("")}
              className="clear-search-btn"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="surveys-table">
        <table>
          <thead>
            <tr>
              <th>Survey Name</th>
              <th>Duration</th>
              <th>Timestamp</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {surveys.length === 0 ? (
              <tr>
                <td colSpan="5" className="empty-state">
                  {searchTerm
                    ? "No surveys found matching your search."
                    : "No surveys found. New surveys will appear here when created."}
                </td>
              </tr>
            ) : (
              surveys.map((survey) => (
                <tr key={survey.id} className="survey-row">
                  <td className="survey-name">{survey.name}</td>
                  <td className="survey-duration">
                    {formatDuration(survey.gps_tracks?.duration)}
                  </td>
                  <td>{survey.timestamp}</td>
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
                    {survey.video_id == null ? (
                      <VideoUpload
                        surveyId={survey.id}
                        onUploadComplete={handleUploadComplete}
                        accessToken={accessToken}
                      />
                    ) : (
                      <button
                        className="view-button"
                        onClick={() =>
                          window.open(survey.videos?.[0]?.url, "_blank")
                        }
                      >
                        View Video
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Home;
