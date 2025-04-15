import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import VideoUpload from '../components/VideoUpload'
import { Toaster, toast } from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'

function Home() {
  const [surveys, setSurveys] = useState([])
  const [loading, setLoading] = useState(true)
  const [accessToken, setAccessToken] = useState(null)
  const { user, isAdmin, isManager } = useAuth()

  useEffect(() => {
    if (user) {
      fetchSurveys()
      getAccessToken()
    }
  }, [user])

  const getAccessToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    setAccessToken(session?.access_token)
  }

  const fetchSurveys = async () => {
    if (!user) return

    try {
      setLoading(true)
      
      if (isAdmin) {
        // Admin sees all surveys
        const { data, error } = await supabase
          .from('surveys')
          .select(`
            *,
            videos (*)
          `)
          .order('timestamp', { ascending: false })
          
        if (error) throw error
        setSurveys(data)
      } 
      else if (isManager) {
        // Managers see their own surveys
        const { data: ownSurveys, error: ownError } = await supabase
          .from('surveys')
          .select(`
            *,
            videos (*)
          `)
          .eq('user_id', user.id)
          .order('timestamp', { ascending: false })
          
        if (ownError) throw ownError
        
        // And surveys from their surveyors
        const { data: surveyorIds, error: surveyorError } = await supabase
          .from('users')
          .select('user_id')
          .eq('manager_id', user.id)
          
        if (surveyorError) throw surveyorError
          
        // If has surveyors, get their surveys too
        let surveyorSurveys = []
        if (surveyorIds && surveyorIds.length > 0) {
          const surveyorIdList = surveyorIds.map(s => s.user_id)
          const { data: teamSurveys, error: teamError } = await supabase
            .from('surveys')
            .select(`
              *,
              videos (*)
            `)
            .in('user_id', surveyorIdList)
            .order('timestamp', { ascending: false })
            
          if (teamError) throw teamError
          surveyorSurveys = teamSurveys
        }
        
        // Combine both sets of surveys
        setSurveys([...ownSurveys, ...surveyorSurveys])
      } 
      else {
        // Surveyors only see their own surveys
        const { data, error } = await supabase
          .from('surveys')
          .select(`
            *,
            videos (*)
          `)
          .eq('user_id', user.id)
          .order('timestamp', { ascending: false })
          
        if (error) throw error
        setSurveys(data)
      }
    } catch (error) {
      console.error('Error fetching surveys:', error)
      toast.error('Failed to load surveys')
    } finally {
      setLoading(false)
    }
  }

  const handleUploadComplete = async (surveyId, fileName) => {
    const toastId = toast.loading('Processing upload...')
    try {
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('videos')
        .getPublicUrl(`${surveyId}/${fileName}`)

      // Create video record and update survey in a transaction
      const { data: videoData, error: videoError } = await supabase
        .from('videos')
        .insert({
          name: fileName,
          url: publicUrl,
          survey_id: surveyId
        })
        .select()
        .single()

      if (videoError) throw videoError

      // Update survey with video_id and is_video_uploaded
      const { error: surveyError } = await supabase
        .from('surveys')
        .update({ 
          video_id: videoData.id,
          is_video_uploaded: true 
        })
        .eq('id', surveyId)

      if (surveyError) throw surveyError

      // Refresh surveys list
      await fetchSurveys()
      toast.success('Video uploaded successfully!', { id: toastId })
    } catch (error) {
      console.error('Error processing upload:', error)
      toast.error('Failed to process upload', { id: toastId })
    }
  }

  if (loading) {
    return <div className="loading">Loading...</div>
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
            {surveys.length === 0 ? (
              <tr>
                <td colSpan="4" className="empty-state">
                  No surveys found. New surveys will appear here when created.
                </td>
              </tr>
            ) : (
              surveys.map((survey) => (
                <tr key={survey.id} className="survey-row">
                  <td className="survey-name">{survey.name}</td>
                  <td>{new Date(survey.timestamp).toLocaleString()}</td>
                  <td>
                    <span className={`status-badge ${survey.video_id == null ? 'pending' : 'uploaded'}`}>
                      {survey.video_id == null ? 'Pending Upload' : 'Video Uploaded'}
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
                      <button className="view-button" onClick={() => window.open(survey.videos?.[0]?.url, '_blank')}>
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
  )
}

export default Home 